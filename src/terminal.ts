import { Terminal, terminal } from 'terminal-kit';
import { Main } from './main';

export class TerminalUI {
    main: Main;
    term: Terminal;

    constructor(main: Main) {
        this.main = main;
        this.term = terminal;
        this.term("\n");
        this.term.on('key', function (name: string, matches: any, data: any) {
            if (name === 'CTRL_C') { process.exit(); }
        });
        this.showMainMenu(this.term);
    }

    private showMainMenu(t: Terminal) {
        var items = ['Show Connections', 'Add User', 'Remove User'];

        var options = {
            y: 1,	// the menu will be on the top of the terminal
            style: t.inverse,
            selectedStyle: t.dim.blue.bgGreen
        };
        t.clear();
        t("\n");
        t.singleLineMenu(items, options, (error, response) => {
            switch (response.selectedIndex) {
                case 0:
                    this.showConnections(t);
                    break;
                case 1:

                case 2:

                default:
                    break;
            }
        });
    }

    private showConnections(t: Terminal) {
        // TODO time alive
        let content = [["Username", "Alive"]];
        this.main.socket.wss.clients.forEach((client) => {
            const wsc = (client as any);
            content.push([wsc.name, wsc.isAlive]);
        });
        t.table(content, { hasBorder: true });
        this.term.on('key', (name: string, matches: any, data: any) => {
            if (name === 'ESCAPE') { this.showMainMenu(t) }
        });
    }

    private addUser(t: Terminal) {
        // this.main.users.set(incomingUserUpdate.name, incomingUserUpdate)
        // this.main.pgHandler.insertOrUpdateUser(incomingUserUpdate as VegaUser).then(() => this.sendUpdatedUsers())
    }

    private removeUser(t: Terminal) {

    }
}