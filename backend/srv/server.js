const cds = require('@sap/cds');
const { isConfigured: aiConfigured } = require('./lib/ai');

// The frontend now runs as its own static server on a different origin
// (see frontend/server.js) instead of being served by CAP itself, so the
// browser treats every request to this API as cross-origin and blocks it
// unless we say otherwise. Credentialed requests (Basic Auth, via
// `credentials: "include"` on the frontend's fetch calls) can't use the
// `*` wildcard — the origin must be echoed back explicitly — so this is a
// single allowed origin, not an open CORS policy. Registered on
// cds.on('bootstrap') so it runs before CAP mounts the OData protocol
// adapters, not just before our own /user-api route below.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';

cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', FRONTEND_URL);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    // The UI5 OData v4 model sends several of its own request headers
    // (X-CSRF-Token for CAP's CSRF protection, sap-cancel-on-close for
    // request-cancellation semantics, and others depending on the UI5
    // version) that a fixed allow-list would need to keep chasing one at a
    // time. Reflecting back whatever the browser's own preflight says it
    // intends to send (Access-Control-Request-Headers) is the standard,
    // robust answer to "an unknown set of client headers needs to pass" —
    // it only ever grants exactly what this specific request already
    // declared it was going to send, not an open door.
    res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Authorization, X-CSRF-Token');
    // Cross-origin JS can only read safelisted response headers unless they're
    // exposed here. UI5 rejects every OData response without a readable
    // OData-Version, and reads the others for CSRF, messages, and ETags.
    res.set('Access-Control-Expose-Headers', 'OData-Version, X-CSRF-Token, sap-messages, Location, ETag, Preference-Applied, Date, Last-Modified, Age, sap-metadata-last-modified');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
});

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
      },
      // AI-02: the UI disables the AI assistant button (with a tooltip)
      // instead of letting the user hit an error — checked once here
      // rather than adding a dedicated OData round trip just for a flag.
      aiAvailable: aiConfigured()
    });
  });
});

module.exports = cds.server;
