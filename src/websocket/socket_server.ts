import { IncomingMessage } from "http";
import { Socket } from "net";
import { URL } from "url";
import jwt from "jsonwebtoken";
import WebSocket, { WebSocketServer } from "ws";
import { Main, Player, PosEntry, VegaUser } from "../main";

export interface CType {
    client: Socket,
}

export interface WSClient extends WebSocket {
    name: string,
    isAlive: boolean,
}

export class SocketServer {
    main: Main
    wss: WebSocketServer
    players: Map<string, Player> = new Map();
    nameMapCache: Map<string, string> = new Map();

    constructor(main: Main) {
        this.main = main
        var self = this
        // TODO: collect info from non-auth users
        this.wss = new WebSocketServer({ port: 8080 });
        this.wss.on("connection", async function connection(ws: WebSocket, request: IncomingMessage) {
            if (!request.url || !/\/\?serverId=.\w*&username=([A-Za-z0-9_]{2,17})/.test(request.url)) {
                ws.send("401");
                console.log(`Connection attempt failed to authenticate: malformed url \"${request.url}\"`);
                ws.close();
                return;
            }

            const url = new URL(`http://${process.env.HOST ?? 'localhost'}${request.url}`)
            const incomingToken = url.searchParams.get("token")!;
            const serverID = url.searchParams.get("serverId")!;
            const username = url.searchParams.get("username")!;

            console.log(`Incoming connection attempt from: ${username} with hash ${serverID}`);
            let dataResponse = -1
            let auth = false;
            try {
                if (incomingToken) {
                    console.log(`${username} sent JWT, verifying`);
                    let v = jwt.verify(incomingToken, main.config.secret);
                    let decoded = jwt.decode(incomingToken, { json: true });
                    if (decoded && decoded.username === username) {
                        auth = true;
                        console.log(`Connection attempt from ${username} authenticated with JWT`);
                    }
                } else {
                    console.log(`No token for ${username}, trying Mojang auth`);
                    dataResponse = await self.tryMojangAuth(ws, username, serverID);
                }
            } catch (e) {
                console.log(e);
                console.log(`Old/invalid token for ${username}, proceeding to Mojang auth`);
                dataResponse = await self.tryMojangAuth(ws, username, serverID);
            }
            if (dataResponse === 200 || auth) {
                if (main.users.has(username) && main.users.get(username)!.permission >= 1) {
                    ws.send("200");
                    (ws as any).name = username;
                    (ws as any).isAlive = true;

                    if (dataResponse === 200) {
                        const token = jwt.sign({ id: main.users.get(username)?.uuid, username: username }, main.config.secret, {
                            expiresIn: '24h',
                        });
                        ws.send(`token?${token}`);
                    }

                    ws.on("error", console.error);
                    self.sendUpdatedUsers();

                    ws.on("message", function message(data: WebSocket.RawData, isBinary: boolean) {
                        // toString here converts the incoming ByteBuffer to a string, assuming that's what it's supposed to be.
                        // What other stuff can we send down as ByteBuffers? 
                        self.parseIncoming(this, data.toString());
                    });

                    ws.on("close", (code: number, reason: Buffer) => {
                        console.log(`Connection to ${username} closed, code ${code}` + (reason ? ` with reason "${reason}"` : ""));
                        ws.close();
                    });

                    ws.on("pong", () => (ws as any).isAlive = true);
                } else {
                    ws.send("401");
                    console.log(`Connection attempt failed to authenticate: user ${username} not authorized`);
                    ws.close();
                    return;
                }
            } else {
                ws.send("401");
                ws.close();
            }
        });

        setInterval(() => {
            if (this.wss.clients.size > 0) {
                this.sendUpdatedPlayers();
            }
        }, 2000);

        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                const wsc = (ws as any);
                if (wsc.isAlive == false) {
                    console.log(`Removing dead client with name ${wsc.name}`);
                    ws.terminate();
                }
                wsc.isAlive = false;
                ws.ping();
            });
        }, 10_000);
    }

    public async parseIncoming(wsc: WebSocket, data: string) {
        let query = data.split("?");
        query = query[1].split("=")
        if (query[0] === "player") {
            if (!(await this.isClientAuthed(wsc))) {
                console.log(`Refused player update from ${(wsc as any).name}, not authed`)
                return;
            }
            const incomingPlayerUpdate = JSON.parse(query[1]) as Player;

            if ((Date.now() - parseInt(incomingPlayerUpdate.time)) / (3.6 * (10 ** 6)) >= 8) {
                console.log(`Not accepting update to ${incomingPlayerUpdate.name} as age >=8hr`)
                return;
            }

            if (this.players.has(incomingPlayerUpdate.name)) {
                const existingPlayer = this.players.get(incomingPlayerUpdate.name)!

                if (existingPlayer.time < incomingPlayerUpdate.time
                    || existingPlayer.position.server != incomingPlayerUpdate.position.server
                    || existingPlayer.position.world != incomingPlayerUpdate.position.world
                ) {
                    this.players.set(existingPlayer.name, incomingPlayerUpdate)
                }
            } else {
                this.players.set(incomingPlayerUpdate.name, incomingPlayerUpdate)
            }
        } else if (query[0] === "user") {
            const incomingUserUpdate = JSON.parse(query[1]) as VegaUser;

            console.log(`Received user update from ${(wsc as any).name} for user ${incomingUserUpdate.name}`)
            if (!(await this.isClientAdmin(wsc))) {
                console.log(`Refused user update from ${(wsc as any).name}, not admin`)
                return;
            }

            if (this.main.users.has(incomingUserUpdate.name) && this.main.users.get(incomingUserUpdate.name)?.permission == 2) {
                console.log(`Refused user update from ${(wsc as any).name}, cannot change fellow admin ${incomingUserUpdate.name}`)
            } else {
                this.main.users.set(incomingUserUpdate.name, incomingUserUpdate)
                this.main.pgHandler.insertOrUpdateUser(incomingUserUpdate as VegaUser).then(() => this.sendUpdatedUsers())
            }
        } else {
            console.log(`Received unknown data ${data} from ${wsc}`);
        }
    }

    public async sendUpdatedUsers() {
        // if (this.main.config.useSnitchBot) {
        //     this.main.pgHandler.sql`SELECT * FROM pos;`.then((rows) => {
        //         rows.forEach((row) => {
        //             let r = row as PosEntry
        //             if (!this.nameMapCache.has(r.name)) {
        //                 const dataResponse = await fetch(`https://playerdb.co/api/player/minecraft/${r.name}`,
        //                     {
        //                         method: "GET",
        //                         headers: {
        //                             "User-Agent": `Email ${this.main.config.UAEmail}`
        //                         }
        //                     });
        //                 const data = (await dataResponse.json()) as any;
        //                 this.nameMapCache.set(r.name, data.player.id)
        //             }



        //             this.main.users.set(r.name, {
        //                 name: r.name,
        //                 uuid: this.nameMapCache.get(r.name)!,
        //                 status: ,
        //                 permission: 
        //             })
        //         })
        //     })
        // }
        this.main.pgHandler.sql`SELECT * FROM vega_users;`.then((rows) => {
            rows.forEach((row) => {
                let r = row as VegaUser
                this.main.users.set(r.name, r)
            })
        })
        this.wss.clients.forEach(async client => {
            if (await this.isClientAuthed(client)) {
                client.send("users?" + JSON.stringify(Array.from(this.main.users.values())));
            }
        })
    }

    public async sendUpdatedPlayers() {
        this.wss.clients.forEach(async client => {
            if (await this.isClientAuthed(client)) {
                this.players.forEach(player => {
                    if ((Date.now() - parseInt(player.time)) / (3.6 * (10 ** 6)) >= 8) {
                        if (this.players.delete(player.name)) {
                            console.log(`Removed ${player.name} as age >=8hr`)
                            return;
                        }
                    }
                    client.send("player?" + JSON.stringify(player))
                });
            }
        });
    }

    public async isClientAuthed(client: WebSocket) {
        const wscName = (client as any).name
        const foundUser = this.main.users.get(wscName);

        if (!foundUser || !(foundUser.permission >= 1)) {
            return false;
        }

        return true;
    }

    public async isClientAdmin(client: WebSocket) {
        const wscName = (client as any).name
        const foundUser = this.main.users.get(wscName);

        if (!foundUser || !(foundUser.permission >= 2)) {
            return false;
        }

        return true;
    }

    private async tryMojangAuth(ws: WebSocket, username: string, serverID: string) {
        let dataResponse = (await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${username}&serverId=${serverID}`)).status;
        if (dataResponse != 200) {
            ws.send("401");
            console.log(`Connection attempt failed to authenticate: bad response (${dataResponse}) from Mojang`);
            ws.close();
        } else {
            console.log(`Connection attempt from ${username} authenticated with Mojang.`);
        }

        return dataResponse;
    }
}