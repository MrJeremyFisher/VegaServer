import { IncomingMessage } from "http";
import { Socket } from "net";
import { URL } from "url";
import WebSocket, { WebSocketServer } from "ws";
import { Main, Player, VegaUser } from "../main";

export interface CType {
    client: Socket,

}

export class SocketServer {
    main: Main
    wss: WebSocketServer
    players: Player[] = []

    constructor(main: Main) {
        this.main = main
        var self = this

        this.wss = new WebSocketServer({ port: 8080 });
        console.log("Server started on port 8080");
        this.wss.on("connection", async function connection(ws: WebSocket, request: IncomingMessage) {
            if (!request.url || !/\/\?serverId=.\w*&username=([A-Za-z0-9_]{2,17})/.test(request.url)) {
                ws.send("401");
                console.log("Connection attempt failed to authenticate: malformed url");
                ws.close();
                return;
            }

            const url = new URL(`http://${process.env.HOST ?? 'localhost'}${request.url}`)
            const serverID = url.searchParams.get("serverId")!;
            const username = url.searchParams.get("username")!;

            console.log(`Incoming connection attempt from: ${username} with hash ${serverID}`);


            const dataResponse = await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${username}&serverId=${serverID}`);

            if (dataResponse.status === 200) {
                if (main.users.find((element) => {
                    return element.name === username
                })) {
                    ws.send("200");
                    (ws as any).name = username
                    console.log("Connection attempt authenticated.");
                    ws.on("error", console.error);

                    ws.on("message", function message(data: WebSocket.RawData, isBinary: boolean) {
                        // toString here converts the incoming ByteBuffer to a string, assuming that's what it's supposed to be.
                        // What other stuff can we send down as ByteBuffers? 
                        self.parseIncoming(this, data.toString())
                    });
                } else {
                    ws.send("401");
                    console.log(`Connection attempt failed to authenticate: user ${username} not authorized`);
                    ws.close();
                    return;
                }
            } else {
                ws.send("401");
                console.log(`Connection attempt failed to authenticate: bad response (${dataResponse.status}) from Mojang`);
                ws.close();
                return;
            }
        });

        setInterval(() => {
            if (this.wss.clients.size > 0) {
                this.sendUpdatedPlayers()
                this.sendUpdatedUsers()
            }
        }, 2000);
    }

    public async parseIncoming(wsc: WebSocket, data: string) {


        let query = data.split("?");
        query = query[1].split("=")
        if (query[0] === "player") {
            if (!(await this.isClientAuthed(wsc))) {
                console.log(`Refused player update from ${(wsc as any).name}, not authed`)
                return;
            }
            const incomingPlayerUpdate = JSON.parse(query[1]);
            const idx = this.players.findIndex(player => {
                return player.name == incomingPlayerUpdate.name
            });

            if (idx != -1) {
                if (this.players[idx].time < incomingPlayerUpdate.time) {
                    this.players[idx] = incomingPlayerUpdate;
                }
            } else {
                this.players.push(incomingPlayerUpdate)
            }
        } else if (query[0] === "user") {
            if (!(await this.isClientAdmin(wsc))) {
                console.log(`Refused user update from ${(wsc as any).name}, not admin`)
                return;
            }
            const incomingUserUpdate = JSON.parse(query[1]);
            const idx = this.main.users.indexOf(incomingUserUpdate as VegaUser);
            if (idx == -1) {
                this.main.users.push(incomingUserUpdate as VegaUser);
            } else {
                this.main.users[idx] = incomingUserUpdate as VegaUser
            }

            this.main.pgHandler.insertOrUpdateUser(incomingUserUpdate as VegaUser);
        }

        else {
            console.log(`Received unknown data ${data} from ${wsc}`);
        }
    }

    public async sendUpdatedUsers() {
        this.main.pgHandler.sql`SELECT * FROM vega_users;`.then((rows) => {
            rows.forEach((row) => {
                this.main.users.push(row as VegaUser)
            })
        })
        this.wss.clients.forEach(async client => {
            if (await this.isClientAuthed(client)) {
                client.send("users?" + JSON.stringify(this.main.users))
            }
        })
    }

    public async sendUpdatedPlayers() {
        this.wss.clients.forEach(async client => {
            if (await this.isClientAuthed(client)) {
                this.players.forEach(player => {
                    if ((Date.now() - parseInt(player.time)) / (3.6 * 10 ^ 6) >= 1) {
                        let idx = this.players.indexOf(player)
                        if (idx > -1) {
                            this.players.splice(idx);
                        }
                    }
                    client.send("player?" + JSON.stringify(player))
                });
            }
        });
    }

    public async isClientAuthed(client: WebSocket) {
        const wscName = (client as any).name
        const foundUser = this.main.users.find(vegaUser => vegaUser.name === wscName);

        if (!foundUser || !(foundUser.permission >= 1)) {
            return false;
        }

        return true;
    }

    public async isClientAdmin(client: WebSocket) {
        const wscName = (client as any).name
        const foundUser = this.main.users.find(vegaUser => vegaUser.name === wscName);

        if (!foundUser || !(foundUser.permission >= 2)) {
            return false;
        }

        return true;
    }
}
