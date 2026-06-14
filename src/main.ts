import { PgHandler } from "./pghandler";
import { SocketServer } from "./websocket/socket_server";

export interface Position {
    x: string,
    y: string,
    z: string,
    world: string
}

export interface Player {
    time: string,
    name: string,
    uuid: string,
    position: Position
}

export interface VegaUser {
    name: string,
    uuid: string,
    // 0: neutral, 1: ally, 2: watch, 3: enemy
    status: 0 | 1 | 2 | 3,
    // 0: unauthed, 1: user, 2: admin
    permission: 0 | 1 | 2
}

export interface Config {
    dbURL: string
}


export class Main {
    users: VegaUser[] = []
    players: Player[] = []
    pgHandler: PgHandler
    config: Config
    // authorizedUsers = ["MrJeremyFisher", "Hg__80", "binchymonkey", "IKEA_FRIDGE"]

    constructor() {
        switch (process.env.NODE_ENV) {
            case "dev":
                this.config = require('../config-test.json')
                break;
            case "prod":
                this.config = require('../config.json')
                break;
            default:
                throw new Error("No config type specified!")
        }

        this.pgHandler = new PgHandler(this)
        this.pgHandler.sql`CREATE TABLE IF NOT EXISTS vega_users (
                    name VARCHAR(32), 
                    uuid VARCHAR(128),
                    status INT,
                    permission INT
                    );`.then(() => {
            this.pgHandler.sql`SELECT * FROM vega_users;`.then((rows) => {
                rows.forEach((row) => {
                    this.users.push(row as VegaUser)
                })
            })
        })
    }
}

const main = new Main()

new SocketServer(main);