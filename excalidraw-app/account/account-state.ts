import { atom } from "../app-jotai";

/**
 * Qual diálogo da conta está aberto.
 *
 * Precisa viver fora do menu: ao selecionar um item, o conteúdo do menu é
 * desmontado (radix), então qualquer estado guardado dentro dele se perderia —
 * o diálogo nunca apareceria.
 */
export const accountDialogAtom = atom<"key" | "logout" | null>(null);
