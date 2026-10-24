/** The leasing team for @mentions: employees with the market field set. Empty when the role cannot read employees (the composer then says so). */
export function routeTeam(ctx) {
  const team = ctx.dao.people.team();
  return { me: String(ctx.scope.userId), team, available: team.length > 0 };
}
