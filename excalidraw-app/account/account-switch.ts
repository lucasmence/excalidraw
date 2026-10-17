/**
 * Troca de conta em curso.
 *
 * Trocar de conta é: salvar o que está pendente → trocar a sessão → recarregar.
 * Quem carrega a cena da conta que entra é a recarga; até ela acontecer, o que
 * está na tela ainda é da conta que saiu. Nesse intervalo nada mais pode ser
 * gravado (a cena de uma conta cairia na outra) nem a saída pode ser bloqueada
 * — o `Collab` bloqueia a saída enquanto a sala estiver sem gravar, e isso
 * inclui a própria recarga da troca: com o aviso do navegador no meio, o
 * usuário que responde "ficar" fica com a conta nova na sessão e a cena antiga
 * na tela, e a próxima edição grava essa cena na conta que entrou.
 *
 * Fica num módulo só (como `reload`) para os testes observarem, e sem importar
 * nada para poder ser usado na sessão, no storage e na colaboração sem ciclo.
 */
let switching = false;

export const beginAccountSwitch = () => {
  switching = true;
};

/** o app vai subir como outra conta: a tela atual não é mais dona de dados */
export const isAccountSwitching = () => switching;

/**
 * Volta ao estado normal. Só os testes precisam: na vida real a troca termina
 * em recarga, que já nasce com este módulo limpo.
 */
export const resetAccountSwitch = () => {
  switching = false;
};
