/**
 * @license
 * Copyright 2017 JBoss Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    Component, Inject, ViewChild, Injectable, ViewChildren, QueryList,
    AfterViewInit, NgZone
} from "@angular/core";
import {ActivatedRoute, Router, CanDeactivate} from "@angular/router";
import {EditableApiDefinition} from "../../../../models/api.model";
import {ApiEditorUser, IApiEditingSession, IApisService} from "../../../../services/apis.service";
import {ApiEditorComponent} from "./editor.component";
import {AbstractPageComponent} from "../../../../components/page-base.component";
import {ICommand, OtCommand} from "oai-ts-commands";
import {BehaviorSubject} from "rxjs/BehaviorSubject";
import {Observable} from "rxjs/Observable";
import {EditorDisconnectedDialogComponent} from "./_components/dialogs/editor-disconnected.component";
import {ApiDesignCommandAck} from "../../../../models/ack.model";

@Component({
    moduleId: module.id,
    selector: "api-editor-page",
    templateUrl: "api-editor.page.html",
    styleUrls: ["api-editor.page.css"]
})
export class ApiEditorPageComponent extends AbstractPageComponent implements AfterViewInit {

    public apiDefinition: EditableApiDefinition;

    protected isDirty: boolean = false;
    protected isSaving: boolean = false;

    @ViewChildren("apiEditor") _apiEditor: QueryList<ApiEditorComponent>;
    @ViewChild("editorDisconnectedModal") editorDisconnectedModal: EditorDisconnectedDialogComponent;

    private editingSession: IApiEditingSession;
    private activeCollaborators: ApiEditorUser[] = [];
    private _activeCollaboratorIcons: string[] = [
        "tree", "bus", "bomb", "university", "rocket", "taxi"
    ];
    private _activeCollaboratorColors: string[] = [
        "#50A162", "#B65B80", "#D94C4C", "#477187", "#D4786A", "#B10DC9"
    ];

    private pendingCommands: OtCommand[] = [];
    private _pendingCommandsSubject: BehaviorSubject<OtCommand[]> = new BehaviorSubject([]);
    private _pendingCommands: Observable<OtCommand[]> = this._pendingCommandsSubject.asObservable();

    /**
     * Constructor.
     * @param {Router} router
     * @param {ActivatedRoute} route
     * @param {NgZone} zone
     * @param {IApisService} apis
     */
    constructor(private router: Router, route: ActivatedRoute, private zone: NgZone,
                @Inject(IApisService) private apis: IApisService) {
        super(route);
        this.apiDefinition = new EditableApiDefinition();
    }

    /**
     * Called to kick off loading the page's async data.
     * @param params
     */
    public loadAsyncPageData(params: any): void {
        let __component: ApiEditorPageComponent = this;

        console.info("[ApiEditorPageComponent] Loading async page data");
        let apiId: string = params["apiId"];
        this.apiDefinition.name = apiId;
        this.apiDefinition.id = apiId;

        this.apis.editApi(apiId).then( def => {
            console.info("[ApiEditorPageComponent] Definition loaded.  Opening editing session.");
            this.apiDefinition = def;
            this.loaded("def");
            this.editingSession = this.apis.openEditingSession(def);
            this.editingSession.commandHandler({
                onCommand: (command) => {
                    this.zone.run(() => {
                        __component.executeCommand(command);
                    });
                },
                onAck: (ack) => {
                    this.zone.run(() => {
                        __component.finalizeCommand(ack);
                    });
                }
            });
            this.editingSession.activityHandler( {
                onJoin: (user) => {
                    this.zone.run(() => {
                        if (this._activeCollaboratorIcons.length === 0) {
                            user.attributes["icon"] = "user-secret";
                            user.attributes["color"] = "crimson";
                        } else {
                            user.attributes["icon"] = this._activeCollaboratorIcons.splice(0, 1)[0];
                            user.attributes["color"] = this._activeCollaboratorColors.splice(0, 1)[0];
                        }
                        this.activeCollaborators.push(user);
                        this.activeCollaborators.sort((c1, c2) => {
                            return c1.userName.localeCompare(c2.userName);
                        });
                    });
                },
                onLeave: (user) => {
                    this.zone.run(() => {
                        if (user.attributes["icon"]) {
                            this._activeCollaboratorIcons.push(user.attributes["icon"]);
                        }
                        if (user.attributes["color"]) {
                            this._activeCollaboratorColors.push(user.attributes["color"]);
                        }
                        for (let idx = this.activeCollaborators.length - 1; idx >= 0; idx--) {
                            if (this.activeCollaborators[idx].userId === user.userId) {
                                this.activeCollaborators.splice(idx, 1);
                                return;
                            }
                        }
                    });
                }
            });
            this.editingSession.connect({
                onConnected: () => {
                    console.info("[ApiEditorPageComponent] Editing session connected.  Marking 'session' as loaded.");
                    this.zone.run(() => {
                        this.loaded("session");
                    });
                },
                onClosed: () => {
                    console.info("[ApiEditorPageComponent] **Notice** editing session disconnected normally.");
                },
                onDisconnected: (code) => {
                    // TODO what to do when an unexpected disconnect event happens??
                    console.info("[ApiEditorPageComponent] **Notice** editing session DROPPED!  Reason code: %o", code);
                    this.zone.run(() => {
                        this.editorDisconnectedModal.open();
                    });
                }
            });
        }).catch(error => {
            console.error("[ApiEditorPageComponent] Error editing API design.");
            this.error(error);
        });
    }

    public ngAfterViewInit(): void {
        this._apiEditor.changes.subscribe( () => {
            if (this._apiEditor.first) {
                console.info("Editor is available!");
                this._pendingCommands.subscribe( commands => {
                    this.pendingCommands = [];
                    commands.forEach( command => {
                        this._apiEditor.first.executeCommand(command);
                    });
                });
            }
        });
    }

    public loadingState(): string {
        if (this.isLoaded("session")) {
            return "loaded";
        }
        if (this.isLoaded("def")) {
            return "loading-session";
        }
        return "loading-def";
    }

    /**
     * Called when the page is destroyed.
     */
    public ngOnDestroy(): void {
        this.editingSession.close();
    }

    /**
     * Called when the editor fires this event.
     * @param {ICommand} command
     */
    public onCommandExecuted(command: OtCommand): void {
        this.editingSession.sendCommand(command);
    }

    /**
     * Executes the given command in the editor.
     * @param {ICommand} command
     */
    protected executeCommand(command: OtCommand): void {
        this.pendingCommands.push(command);
        this._pendingCommandsSubject.next(this.pendingCommands);
    }

    /**
     * Finalizes a given command after receiving an ack from the server.
     * @param {ApiDesignCommandAck} ack
     */
    protected finalizeCommand(ack: ApiDesignCommandAck): void {
        this._apiEditor.first.finalizeCommand(ack);
    }
}


/**
 * Guards against the user losing changes to the editor.
 */
@Injectable()
export class ApiEditorPageGuard implements CanDeactivate<ApiEditorPageComponent> {

    /**
     * Called by angular 2 to determine whether the user is allowed to navigate away from the
     * editor.
     * @param component
     */
    public canDeactivate(component: ApiEditorPageComponent): Promise<boolean> | boolean {
        return true;
    }

}
