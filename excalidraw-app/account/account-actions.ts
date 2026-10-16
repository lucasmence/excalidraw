/**
 * Ações de conta que mexem no app inteiro: alternar e sair.
 *
 * A cena, as abas, a biblioteca, as imagens e a sala fixa de colaboração
 * pertencem a uma conta só, e o editor já carregou tudo isso para a conta
 * ativa. Por isso a troca é sempre: salvar o que está pendente → trocar a
 * sessão → recarregar. É o mesmo caminho do "trocar de conta" do Google, que
 * também é uma navegação nova.
 */
import {
  collabRoomOf,
  getActiveSession,
  logout,
  resumableAccounts,
  switchAccount,
} from "../auth/session";
import { getCollaborationLink } from "../data";
import { LocalData } from "../data/LocalData";

import { reloadApp } from "./reload";

/**
 * Publica na URL a sala fixa da conta ativa — sem conta, tira o link da URL.
 *
 * A troca de conta recarrega o app, e a recarga preserva a URL: sem isto o link
 * da sala da conta que saiu continuaria ali, e o app abriria a sala dela em vez
 * da sala padrão da conta que entrou.
 */
export const applyActiveAccountRoomUrl = () => {
  const room = collabRoomOf();
  const url = room
    ? getCollaborationLink(room)
    : `${window.location.origin}${window.location.pathname}`;

  window.history.replaceState({}, "", url);
};

/**
 * Recarrega o app já apontando a URL para a sala da conta que entrou. Vale para
 * qualquer entrada de conta (troca ou "adicionar conta"): o editor é de uma
 * conta só, e a cena recarregada é a dela.
 */
export const reloadIntoActiveAccount = () => {
  applyActiveAccountRoomUrl();
  reloadApp();
};

/**
 * Passa para outra conta guardada neste navegador. O flush vem antes de
 * propósito: o save é debounced e, disparado depois da troca, gravaria os dados
 * da conta que saiu na conta que entrou.
 */
export const switchToAccount = async (accountId: string) => {
  await LocalData.flushSaveAsync();
  await switchAccount(accountId);
  reloadIntoActiveAccount();
};

/**
 * Sai da conta ativa: apaga a cópia local dela e passa para a próxima conta
 * guardada. Sem nenhuma sobrando, quem manda é o estado da sessão — o
 * `AccountBoundary` mostra a tela de conta.
 */
export const signOutActiveAccount = async () => {
  const accountId = getActiveSession()?.accountId;

  if (accountId) {
    LocalData.clearAccountData(accountId);
  }

  logout();

  const next = resumableAccounts()[0];

  if (next) {
    await switchToAccount(next.accountId);
  }
};
