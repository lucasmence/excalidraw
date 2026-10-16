import { atom } from "../app-jotai";

/**
 * Qual diálogo da conta está aberto.
 *
 * Precisa viver fora do menu: ao selecionar um item, o conteúdo do menu é
 * desmontado (radix), então qualquer estado guardado dentro dele se perderia —
 * o diálogo nunca apareceria.
 */
export const accountDialogAtom = atom<"key" | "accounts" | "logout" | null>(
  null,
);

/**
 * Id da conta que estava ativa quando o usuário pediu para **adicionar** outra.
 * Enquanto isso vale, o `AccountBoundary` mostra a tela de conta no lugar do
 * editor (o editor é da conta atual e não pode salvar nada durante a troca) e a
 * conta que entrar assume o lugar; `null` = não estamos adicionando conta.
 */
export const addingAccountAtom = atom<string | null>(null);

// -----------------------------------------------------------------------------
// como uma conta aparece na interface
// -----------------------------------------------------------------------------

/** a frase é o único identificador: mostra um pedaço dele, estável e curto */
export const shortAccountId = (accountId: string) =>
  `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;

/**
 * Como a conta se apresenta na interface: o apelido quando o usuário deu um,
 * senão o pedaço do id. É o que torna a troca de contas reconhecível — sem
 * apelido, duas contas são só dois códigos parecidos.
 */
export const accountLabel = (account: {
  accountId: string;
  name?: string | null;
}) => account.name || shortAccountId(account.accountId);

/** cores do avatar; determinísticas, porque não existe foto nem email aqui */
const ACCOUNT_COLORS = [
  "#6965db",
  "#0b7285",
  "#2b8a3e",
  "#a61e4d",
  "#d9480f",
  "#5f3dc4",
  "#1864ab",
];

/** cor do avatar de uma conta, sempre a mesma para o mesmo id */
export const accountColor = (accountId: string) => {
  let hash = 0;
  for (const char of accountId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 99991;
  }
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
};

/**
 * Iniciais do avatar: as do apelido (primeira letra de até duas palavras) ou,
 * sem apelido, os dois primeiros caracteres do id.
 */
export const accountInitials = (label: string) => {
  const words = label.trim().split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return label.trim().slice(0, 2).toUpperCase();
};
