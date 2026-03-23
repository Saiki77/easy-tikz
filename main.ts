import { Plugin } from 'obsidian';
import { TikzModal } from './src/modal';

export default class SimpleTikzPlugin extends Plugin {
    async onload() {
        this.addRibbonIcon('square-function', 'TikZ Graph Helper', () => {
            new TikzModal(this.app).open();
        });
    }
}
