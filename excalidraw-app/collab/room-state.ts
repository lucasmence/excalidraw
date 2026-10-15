import { atom } from "../app-jotai";

/**
 * Se o diálogo da sala de colaboração está aberto (criar a sessão, copiar o
 * link, encerrá-la).
 *
 * Vive fora do menu de propósito: ao selecionar um item, o conteúdo do menu é
 * desmontado (radix) e qualquer estado guardado dentro dele se perderia — o
 * mesmo motivo de `account-state`.
 */
export const roomDialogAtom = atom<boolean>(false);
