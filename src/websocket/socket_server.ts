import { IncomingMessage } from "http";
import { Socket } from "net";
import { URL } from "url";
import WebSocket, { WebSocketServer } from "ws";
import { Main, Player, VegaUser } from "../main";

export class SocketServer {
    main: Main
    wss: WebSocketServer
    players: Player[] = []

    constructor(main: Main) {
        this.main = main
        var self = this

        this.wss = new WebSocketServer({ port: 8080 });
        console.log("Server started on port 8080");
        this.wss.on("connection", async function connection(ws: WebSocket, request: IncomingMessage, client: Socket) {
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

                    console.log("Connection attempt authenticated.");
                    ws.on("error", console.error);

                    ws.on("message", function message(data) {
                        // toString here converts the incoming ByteBuffer to a string, assuming that's what it's supposed to be.
                        // What other stuff can we send down as ByteBuffers? 
                        self.parseIncoming(data.toString(), client)
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

    public async parseIncoming(data: string, client: Socket) {
        let query = data.split("?");
        query = query[1].split("=")
        if (query[0] === "player") {
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
            const incomingUserUpdate = JSON.parse(query[1]);
            const idx = this.main.users.indexOf(incomingUserUpdate as VegaUser);
            if (idx == -1) {
                this.main.users.push(incomingUserUpdate as VegaUser);
            } else {
                this.main.users[idx] = incomingUserUpdate as VegaUser
            }


        }

        else {
            console.log(`Received unknown data ${data} from ${client}`);
        }
    }

    public async sendUpdatedUsers() {
        this.wss.clients.forEach(client => {
            client.send("users?" + JSON.stringify(this.main.users))
        })
    }

    public async sendUpdatedPlayers() {
        this.wss.clients.forEach(client => {
            this.players.forEach(player => {
                if ((Date.now() - parseInt(player.time)) / (3.6 * 10 ^ 6) >= 1) {
                    let idx = this.players.indexOf(player)
                    if (idx > -1) {
                        this.players.splice(idx);
                    }
                }
                client.send("player?" + JSON.stringify(player))
            });
        });
    }
}
