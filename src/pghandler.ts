import postgres, { Sql } from "postgres";
import { Main, VegaUser } from "./main";

// export class SnitchHit {
//     player_name: string
//     snitch_name: string
//     x: string
//     y: string
//     z: string
//     world: string
//     time: string

//     constructor(player_name: string,
//         snitch_name: string,
//         x: string,
//         y: string,
//         z: string,
//         world: string,
//         time: string) {
//         this.player_name = player_name
//         this.snitch_name = snitch_name
//         this.x = x
//         this.y = y
//         this.z = z
//         this.world = world
//         this.time = time
//     }
// }

export class PgHandler {
    sql: Sql
    constructor(main: Main) {
        this.sql = postgres(main.config.dbURL)


        // I think the way I want this to go is to have status be 
        // 0: neutral, 1: ally, 2: watch, 3: enemy
        // and permission be 
        // 0: unauthorized (can't even connected to the websocket, I think these entries shouldn't ever even show up in the db unless someone is demoted)
        // 1: user, 2: admin
    }

    public async insertOrUpdateUser(player: VegaUser) {
        await this.sql`
        INSERT INTO vega_users (player_name, uuid, status, permission) VALUES (${player.name}, ${player.uuid}, ${player.status}, ${player.permission})
        ON CONFLICT (uuid) DO UPDATE 
  SET status = ${player.status}, 
      permission = ${player.permission};
        ;`
    }
}