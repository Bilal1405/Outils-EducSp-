/**
 * Reconnaître une base qu'on n'a pas pu joindre.
 *
 * Volontairement à part de `db.ts` : c'est un prédicat sur un code d'erreur,
 * qui n'ouvre rien et ne lit aucune configuration. Le loger dans `db.ts`
 * obligeait tout appelant — un middleware, par exemple — à traîner avec lui
 * `DATABASE_URL` et le pool, pour une comparaison de chaînes.
 *
 * La distinction qu'il permet sert à trois endroits : au déploiement, elle
 * décide si l'on réessaie ; au démarrage, si l'on s'arrête ou si l'on démarre
 * en état dégradé ; en cours de route, si l'on répond « erreur interne » — ce
 * qui serait faux — ou « base injoignable », ce qui est vrai et actionnable.
 */
const CODES_INJOIGNABLE = ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"];

export function baseInjoignable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    CODES_INJOIGNABLE.includes(String((err as { code?: string }).code))
  );
}
