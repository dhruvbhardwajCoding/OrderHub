const cds = require('@sap/cds');

// Does `userDef.roles` include `role`? CAP's own auth middleware (whichever
// kind is configured) mutates cds.env.requires.auth.users[*] in place the
// first time it runs: a plain roles array (['SalesRep']) becomes a
// {SalesRep: 1} map (see cds/lib/req/user.js's `roles` setter). This endpoint
// reads that same shared config, so it must tolerate either shape rather than
// assuming an array.
function hasRole(userDef, role) {
  const roles = userDef && userDef.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(role);
  return !!roles[role];
}

cds.on('served', () => {
  const { 'auth': auth } = cds.env.requires;
  const users = auth && auth.users || {};

  // This route is registered directly on the underlying Express app, outside
  // the CDS protocol adapter's middleware chain — cds.context / cds.context.user
  // are NOT populated here, so credentials are parsed by hand. The challenge
  // realm below is kept identical to CAP's own basic-auth middleware's
  // ("Users") so the browser's cached credentials from this prompt are
  // immediately reused for the actual OData calls, instead of prompting twice.
  cds.app.get('/user-api/currentUser', (req, res) => {
    let userId = null;
    let userDef = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
      const [username, password] = decoded.split(':');
      const candidate = users[username];
      if (candidate && (candidate.password === password || !candidate.password)) {
        userId = username;
        userDef = candidate;
      }
    }

    if (!userId) {
      res.set('WWW-Authenticate', 'Basic realm="Users"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    res.json({
      user: userId,
      roles: {
        SalesRep: hasRole(userDef, 'SalesRep'),
        SalesManager: hasRole(userDef, 'SalesManager'),
        BillingClerk: hasRole(userDef, 'BillingClerk')
      }
    });
  });
});

module.exports = cds.server;
