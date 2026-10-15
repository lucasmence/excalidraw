import { eyeIcon } from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { AccountMenuItems } from "../account/AccountMenuItems";
import { useAtomValue, useSetAtom } from "../app-jotai";
import { isCollaboratingAtom } from "../collab/Collab";
import { roomDialogAtom } from "../collab/room-state";

import { saveDebugState } from "./DebugCanvas";

export const AppMainMenu: React.FC<{
  theme: Theme | "system";
  refresh: () => void;
}> = React.memo((props) => {
  const isCollaborating = useAtomValue(isCollaboratingAtom);
  const setRoomDialogOpen = useSetAtom(roomDialogAtom);

  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      {/* a sala é criada/compartilhada neste diálogo, renderizado fora do menu
          (veja `RoomDialog`): o conteúdo do menu é desmontado ao selecionar */}
      <MainMenu.DefaultItems.LiveCollaborationTrigger
        isCollaborating={isCollaborating}
        onSelect={() => setRoomDialogOpen(true)}
      />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
      <AccountMenuItems />
    </MainMenu>
  );
});
