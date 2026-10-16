/**
 * Recarrega o app.
 *
 * Fica num módulo só para os testes conseguirem observá-lo: o jsdom não navega,
 * e mockar o módulo de ações inteiro esconderia justamente a troca de conta que
 * o teste quer verificar.
 */
export const reloadApp = () => {
  window.location.reload();
};
