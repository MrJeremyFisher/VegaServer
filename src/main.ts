import { PgHandler } from "./pghandler";
import { TerminalUI } from "./terminal";
import { SocketServer } from "./websocket/socket_server";

export interface Position {
    x: string,
    y: string,
    z: string,
    world: string,
    server: string
}

export interface Player {
    time: string,
    name: string,
    uuid: string,
    source: Source,
    position: Position
}

export enum Source {
    LOCAL, // Waypoint comes from an entity in view distance. Should not be shared unless the waypoint is for the local player
    SNITCH, // Waypoint comes from a snitch hit
    REMOTE, // Waypoint comes from remote server
    USER // Waypoint comes from someone using the mod
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
    dbURL: string,
    secret: string,
    useSnitchBot: boolean, // Whether or not the application should interface with the (closed source for now) snitchbot
    UAEmail: string // email for user-agent in requests
}

export interface PosEntry {
    name: string,
    severity: severity,
    reason: string,
    date: string,
    messageID: string,
    adder: string | null
}

export type severity = 'ping' | 'watch'


export class Main {
    users: Map<string, VegaUser> = new Map();
    pgHandler: PgHandler;
    config: Config;
    socket!: SocketServer;
    terminalUI!: TerminalUI;

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
        };

        this.pgHandler = new PgHandler(this);
        this.pgHandler.sql`CREATE TABLE IF NOT EXISTS vega_users (
                    name VARCHAR(32), 
                    uuid VARCHAR(128) UNIQUE,
                    status INT,
                    permission INT
                    );`.then(() => {
            this.pgHandler.sql`SELECT * FROM vega_users;`.then((rows) => {
                rows.forEach((row) => {
                    let r = row as VegaUser;
                    this.users.set(r.name, r);
                })
            });
        }).finally(() => {
            this.socket = new SocketServer(this);
            // this.terminalUI = new TerminalUI(this);
        });
    }
}

const main = new Main()