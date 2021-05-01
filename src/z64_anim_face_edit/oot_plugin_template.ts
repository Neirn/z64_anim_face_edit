import { IPlugin, IModLoaderAPI, ModLoaderEvents } from 'modloader64_api/IModLoaderAPI';
import { EventHandler } from 'modloader64_api/EventHandler';
import { IOOTCore } from 'modloader64_api/OOT/OOTAPI';
import { InjectCore } from 'modloader64_api/CoreInjection';
import { onViUpdate } from 'modloader64_api/PluginLifecycle';
import { readFileSync, writeFileSync } from 'fs';
import { bool_ref, number_ref, string_ref } from 'modloader64_api/Sylvain/ImGui';
import { resolve } from 'path';

const ANIM_FRAME_SIZE = 0x86;

const enum LINKEYE {
    AUTO, /* Automatic Eyes */
    OPEN, /* Open Eyes */
    HALF, /* Half Open Eyes */
    CLOSED, /* Closed Eyes */
    LEFT, /* Look Left */
    RIGHT, /* Look Right */
    SHOCK, /* Shocked / Surprised */
    DOWN, /* Look Down */
    CLTIGHT /* Tightly Closed Eyes */
}

const enum LINKMOUTH {
    AUTO, /* Automatic Mouth */
    CLOSED, /* Closed Mouth */
    SLIGHT, /* Open Mouth (Slight, Playing Ocarina) */
    WIDE, /* Open Mouth (Wide, Shouting) */
    SMILE /* Open Mouth (Smile, Item Get) */
}

interface IExpressionSection {
    start: number;
    end: number;
    expression: LINKEYE | LINKMOUTH;
}

class exprEditorWindow {
    public isOpen: bool_ref = [false];
    public listIdx: number_ref = [0];
    public boxStrings!: string[];
    public exprArr!: IExpressionSection[];
    public name!: string;
    public exprSetList!: string[];
    public exprSetIdx: number_ref = [0];
    public currStart: number_ref = [0];
    public currEnd: number_ref = [0];
    public byteSetter!: (byte: number, expression: number) => number;

    constructor(name: string, exprSetList: string[], byteSetFn: (byte: number, expression: number) => number) {
        this.name = name;
        this.exprSetList = exprSetList;
        this.byteSetter = byteSetFn;
    }
}

class oot_plugin_template implements IPlugin {

    ModLoader!: IModLoaderAPI;
    pluginName?: string | undefined;
    @InjectCore()
    core!: IOOTCore;
    isWindowOpen: boolean[] = [false];
    inputArea: string[] = [""];
    isEnabled: boolean[] = [false];
    isPlayingAnimation: boolean = false;
    isLoopEnabled: boolean[] = [true];
    isLinkFrozen: boolean = false;
    isAnimationPaused: boolean[] = [false];
    currentAnim: number = 0;
    currentAnimLength: number = 0;
    currentAnimDataOffset: number = 0;
    currentFrame: number[] = [0];
    linkAnimationData!: Buffer;
    mouthEditor = new exprEditorWindow("Mouth Editor",
        [
            "AUTO",
            "CLOSED",
            "SLIGHT",
            "WIDE",
            "SMILE"
        ], (byte: number, expression: number) => {
            byte &= 0xF;
            return byte | (expression << 4);
        });
    eyeEditor = new exprEditorWindow("Eye Editor", [
        "AUTO",
        "OPEN",
        "HALF",
        "CLOSED",
        "LEFT",
        "RIGHT",
        "SHOCK",
        "DOWN",
        "CLTIGHT"
    ], (byte: number, expression: number) => {
        byte &= 0xF0
        return byte | expression;
    });

    preinit(): void {
    }
    init(): void {
    }
    postinit(): void {
    }
    onTick(frame?: number): void {
        if (!this.core.helper.isPaused()) {
            if (this.isEnabled[0]) {
                if (this.isPlayingAnimation) {
                    this.freezeLink();

                    this.core.link.anim_data = this.getFrameData(this.currentFrame[0]);

                    if (!this.isAnimationPaused[0]) {
                        this.currentFrame[0]++;
                    }

                    if (this.currentFrame[0] >= this.currentAnimLength) {
                        if (this.isLoopEnabled[0]) {
                            this.currentFrame[0] = 0;
                        } else this.isPlayingAnimation = false;
                    }
                }
                else this.unfreezeLink();
            } else if (this.isLinkFrozen) {
                this.unfreezeLink();
            }
        }
    }

    /* menu bar stuff */
    @onViUpdate()
    onViUpdate() {
        if (this.ModLoader.ImGui.beginMainMenuBar()) {
            if (this.ModLoader.ImGui.beginMenu("Mods")) {
                if (this.ModLoader.ImGui.menuItem("Link Expression Editor##expredit")) {
                    this.isWindowOpen[0] = true;
                }
                this.ModLoader.ImGui.endMenu();
            }
            this.ModLoader.ImGui.endMainMenuBar();
        }

        if (this.isWindowOpen[0]) {
            if (this.ModLoader.ImGui.begin("Link Expression Editor##expredit", this.isWindowOpen)) {

                this.ModLoader.ImGui.inputText("anim path##expredit", this.inputArea);

                if (this.ModLoader.ImGui.button("Load animation##expredit")) {
                    this.ModLoader.utils.setTimeoutFrames(() => {
                        this.isEnabled[0] = this.loadAnimationFile(this.inputArea[0]);

                        if (this.isEnabled[0]) {
                            this.loadAnimProperties();
                        }
                    }, 1);
                }

                if (this.isEnabled[0]) {

                    if (this.ModLoader.ImGui.button("Save Animation##expredit")) {
                        this.ModLoader.utils.setTimeoutFrames(() => {
                            try {
                                writeFileSync(resolve(this.inputArea[0]), this.linkAnimationData);
                            } catch (error) {
                                this.ModLoader.logger.error(error.message);
                            }
                        }, 0);
                    }

                    if (this.ModLoader.ImGui.button("Play##expredit")) {
                        this.isPlayingAnimation = true;
                    }

                    if (this.isPlayingAnimation && this.ModLoader.ImGui.button("Stop##expredit")) {
                        this.isPlayingAnimation = false;
                    }

                    this.ModLoader.ImGui.checkbox("Loop animation##expredit", this.isLoopEnabled);
                    this.ModLoader.ImGui.checkbox("Pause##expredit", this.isAnimationPaused);

                    if (this.isPlayingAnimation && this.isAnimationPaused[0]) {
                        this.ModLoader.ImGui.sliderInt("Current Frame##expredit", this.currentFrame, 0, this.currentAnimLength - 1);
                    }

                    if (this.ModLoader.ImGui.button("Open Eye Editor##expredit")) {
                        this.eyeEditor.isOpen[0] = true;
                    }

                    if (this.ModLoader.ImGui.button("Open Mouth Editor##expredit")) {
                        this.mouthEditor.isOpen[0] = true;
                    }

                    this.loadExprWindow(this.eyeEditor);
                    this.loadExprWindow(this.mouthEditor);

                }

            }
            this.ModLoader.ImGui.end();
        }
    }

    loadExprWindow(win: exprEditorWindow) {
        if (win.isOpen[0]) {
            if (this.ModLoader.ImGui.begin(win.name, win.isOpen)) {
                this.ModLoader.ImGui.listBox("Expression", win.exprSetIdx, win.exprSetList);

                this.ModLoader.ImGui.inputInt("Start##expredit" + win.name, win.currStart);
                this.ModLoader.ImGui.inputInt("End##expredit" + win.name, win.currEnd);

                if (this.ModLoader.ImGui.button("Set Expression")) {
                    this.ModLoader.utils.setTimeoutFrames(() => {
                        if (win.currStart[0] > win.currEnd[0] || win.currEnd[0] > this.currentAnimLength || win.currStart[0] < 0) {
                            this.ModLoader.logger.error("Couldn't set your expression!");
                            return;
                        }

                        for (let i = win.currStart[0]; i <= win.currEnd[0] + 1; i++) {
                            this.linkAnimationData[i * ANIM_FRAME_SIZE - 1] = win.byteSetter(this.linkAnimationData[i * ANIM_FRAME_SIZE - 1], win.exprSetIdx[0]);
                        }

                        this.rebuildExprLists();
                    }, 1);
                }

                if (this.ModLoader.ImGui.listBox("Sections", win.listIdx, win.boxStrings)) {
                    win.currStart[0] = win.exprArr[win.listIdx[0]].start;
                    win.currEnd[0] = win.exprArr[win.listIdx[0]].end;
                    win.exprSetIdx[0] = win.exprArr[win.listIdx[0]].expression;
                }

            }
            this.ModLoader.ImGui.end()
        }
    }

    loadAnimationFile(filePath: string): boolean {
        try {
            this.linkAnimationData = readFileSync(resolve(filePath));

            if (this.linkAnimationData.length % ANIM_FRAME_SIZE !== 0 || !this.linkAnimationData.length) {
                this.ModLoader.logger.error("Not a valid animation file!");
                return false;
            }

            return true;

        } catch (error) {
            this.ModLoader.logger.error(error.message);
            return false;
        }
    }

    freezeLink(): void {
        this.core.link.redeadFreeze = 0x3;
    }

    unfreezeLink(): void {
        this.core.link.redeadFreeze = 0x0;
    }

    getFrameData(frame: number): Buffer {
        return (this.linkAnimationData.slice(this.currentAnimDataOffset + frame * ANIM_FRAME_SIZE, this.currentAnimDataOffset + frame * ANIM_FRAME_SIZE + ANIM_FRAME_SIZE))
    }

    loadAnimProperties(): void {
        this.currentAnimLength = this.linkAnimationData.length / ANIM_FRAME_SIZE;
        this.currentFrame[0] = 0;

        this.rebuildExprLists();
    }

    rebuildExprLists(): void {

        this.mouthEditor.exprArr = [];
        this.eyeEditor.exprArr = [];

        // get first entries
        this.mouthEditor.exprArr.push({
            start: 0,
            end: -1,
            expression: this.getMouthExpr(this.linkAnimationData[ANIM_FRAME_SIZE - 1])
        });

        this.eyeEditor.exprArr.push({
            start: 0,
            end: -1,
            expression: this.getEyeExpr(this.linkAnimationData[ANIM_FRAME_SIZE - 1])
        });

        // all the in-between frames
        for (let i = 1, eyeStreak = 0, mouthStreak = 0; i < this.currentAnimLength; i++) {
            let offset = (i + 1) * ANIM_FRAME_SIZE - 1;
            let currMouth = this.getMouthExpr(this.linkAnimationData[offset]);
            let currEye = this.getEyeExpr(this.linkAnimationData[offset]);

            let currMouthEntry = this.mouthEditor.exprArr[this.mouthEditor.exprArr.length - 1];
            if (currMouthEntry.expression !== currMouth) {
                currMouthEntry.end = currMouthEntry.start + mouthStreak;
                this.mouthEditor.exprArr.push({
                    start: currMouthEntry.start + mouthStreak + 1,
                    end: -1,
                    expression: currMouth
                });
                mouthStreak = -1;
            }

            let currEyeEntry = this.eyeEditor.exprArr[this.eyeEditor.exprArr.length - 1];
            if (currEyeEntry.expression !== currEye) {
                currEyeEntry.end = currEyeEntry.start + eyeStreak;
                this.eyeEditor.exprArr.push({
                    start: currEyeEntry.start + eyeStreak + 1,
                    end: -1,
                    expression: currEye
                });
                eyeStreak = -1;
            }

            mouthStreak++;
            eyeStreak++;
        }

        // last frame info filled in
        let lastFrame = this.currentAnimLength - 1;
        this.mouthEditor.exprArr[this.mouthEditor.exprArr.length - 1].end = lastFrame;
        this.eyeEditor.exprArr[this.eyeEditor.exprArr.length - 1].end = lastFrame;

        // ImGui stuff
        this.mouthEditor.boxStrings = [];
        this.eyeEditor.boxStrings = [];

        this.mouthEditor.exprArr.forEach(entry => {
            this.mouthEditor.boxStrings.push(this.mouthToStr(entry.expression as LINKMOUTH) + ": " + entry.start.toString() + " - " + entry.end.toString());
        });
        this.eyeEditor.exprArr.forEach(entry => {
            this.eyeEditor.boxStrings.push(this.eyeToStr(entry.expression as LINKEYE) + ": " + entry.start.toString() + " - " + entry.end.toString());
        });
    }

    getMouthExpr(byte: number): LINKMOUTH {
        return (byte >> 4) & 0xF;
    }

    getEyeExpr(byte: number): LINKEYE {
        return byte & 0xF;
    }

    mouthToStr(mouth: LINKMOUTH): string {

        let result = "";

        switch (mouth) {
            case LINKMOUTH.AUTO:
                result = "AUTO";
                break;

            case LINKMOUTH.CLOSED:
                result = "CLOSED";
                break;

            case LINKMOUTH.SLIGHT:
                result = "SLIGHT";
                break;

            case LINKMOUTH.SMILE:
                result = "SMILE";
                break;

            case LINKMOUTH.WIDE:
                result = "WIDE";
                break;
            default:
                break;
        }

        return result;
    }

    eyeToStr(eye: LINKEYE): string {

        let result = "";

        switch (eye) {
            case LINKEYE.AUTO:
                result = "AUTO";
                break;

            case LINKEYE.CLOSED:
                result = "CLOSED";
                break;

            case LINKEYE.DOWN:
                result = "DOWN";
                break;

            case LINKEYE.HALF:
                result = "HALF";
                break;

            case LINKEYE.LEFT:
                result = "LEFT";
                break;

            case LINKEYE.OPEN:
                result = "OPEN";
                break;

            case LINKEYE.RIGHT:
                result = "RIGHT";
                break;

            case LINKEYE.SHOCK:
                result = "SHOCK";
                break;

            case LINKEYE.CLTIGHT:
                result = "CLTIGHT";
                break;

            default:
                break;
        }

        return result;
    }

}

module.exports = oot_plugin_template;