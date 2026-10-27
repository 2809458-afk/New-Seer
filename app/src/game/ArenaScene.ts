import Phaser from 'phaser';
import type { GameStore } from '../core/store';

/** 游戏层：只负责表现（场景/精灵/相机/对象池），规则状态从 core 读 */
export class ArenaScene extends Phaser.Scene {
  private store: GameStore;
  private meBar!: Phaser.GameObjects.Rectangle;
  private foeBar!: Phaser.GameObjects.Rectangle;
  private turnText!: Phaser.GameObjects.Text;
  private unsub?: () => void;

  constructor(store: GameStore) {
    super('arena');
    this.store = store;
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0b1220');

    this.add
      .text(width / 2, 72, '精灵对战', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#5f7fa8'
      })
      .setOrigin(0.5, 0);

    const makePet = (x: number, color: number) =>
      this.add
        .rectangle(x, height / 2, 96, 96, color)
        .setStrokeStyle(2, 0x35e2ff, 0.8);

    makePet(width * 0.25, 0x2a4a7a);
    makePet(width * 0.75, 0x7a2a3a);
    const meName = this.add.text(width * 0.25, height / 2 + 65, '', { fontSize: '18px', color: '#9fffd0' }).setOrigin(0.5);
    const foeName = this.add.text(width * 0.75, height / 2 + 65, '', { fontSize: '18px', color: '#ffb3b3' }).setOrigin(0.5);

    this.meBar = this.add.rectangle(40, 120, 240, 10, 0x35e2ff).setOrigin(0, 0.5);
    this.foeBar = this.add.rectangle(width - 40, 120, 240, 10, 0xff6b7a).setOrigin(1, 0.5);

    this.turnText = this.add
      .text(width / 2, height - 28, '回合 1', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#9fc3ff'
      })
      .setOrigin(0.5);

    this.unsub = this.store.subscribe((s) => {
      this.meBar.width = 240 * (s.me.hp / s.me.maxHp);
      this.foeBar.width = 240 * (s.foe.hp / s.foe.maxHp);
      this.turnText.setText(`回合 ${s.turn}`);
      meName.setText(s.me.name);
      foeName.setText(s.foe.name);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsub?.());
  }
}

export function createGame(parent: HTMLElement, store: GameStore): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: parent.clientWidth || 960,
    height: parent.clientHeight || 540,
    backgroundColor: '#0b1220',
    scene: [new ArenaScene(store)],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
  });
}
