import WebSocket, { WebSocketServer } from "ws";

export interface Position {
    x: string
    y: string
    z: string
}

export interface Player {
    time: string
    name: string,
    uuid: string,
    status: "ALLY" | "ENEMY" | "WATCH" | "NEUTRAL",
    position: Position
}

const authorizedUsers = ["MrJeremyFisher", "Hg__80", "binchymonkey"]

export class Main {
    wss: WebSocketServer
    players: Player[] = []


    constructor() {
        var self = this
        this.wss = new WebSocketServer({ port: 8080 });
        console.log("Server started on port 8080");
        this.wss.on("connection", async function connection(ws: WebSocket, request: any, client: any) {
            if (!/\/&serverId=.\w*&username=([A-Za-z0-9_]{2,17})/.test(request.url)) {
                ws.close();
            }

            const incoming = request.url.split("&");
            const serverID = incoming[1];
            const username = incoming[2];
            console.log(`Incoming connection attempt from: ${username.split("=")[1]}`);


            const dataResponse = await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?${username}&${serverID}`);

            if (dataResponse.status === 200 && authorizedUsers.includes(username.split("=")[1])) {
                ws.send(200);

                console.log("Connection attempt authenticated.");
                ws.on("error", console.error);

                ws.on("message", function message(data) {
                    // toString here converts the incoming ByteBuffer to a string, assuming that's what it's supposed to be.
                    // What other stuff can we send down as ByteBuffers? 
                    self.parseIncoming(data.toString(), client)
                });
            } else {
                ws.send(401);
                console.log("Connection attempt failed to authenticate");
                ws.close();
            }
        });

        setInterval(() => {
            console.log(`${this.players.length} players to ${this.wss.clients.size} clients`)
            this.wss.clients.forEach(client => {
                this.players.forEach(player => {
                    // TODO: expire old player records
                    client.send(JSON.stringify(player))
                });
            });
        }, 5000);
    }

    public async parseIncoming(data: string, client: any) {
        const query = data.split("&");
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
        } else {
            console.log(`Received unknown data ${data} from ${client}`);
        }
    }

}

const main = new Main()
