const cds = require('@sap/cds');

cds.on('served', () => {
  const { 'auth': auth } = cds.env.requires;
  const users = auth && auth.users || {};

  // Add the user-api endpoint AFTER CDS middleware is set up
  cds.app.get('/user-api/currentUser', (req, res) => {
    console.log('USER NODE ENVIRONMENT:', process.version, process.arch, process.platform);
    
    // With dummy auth, parse the Authorization header ourselves
    let userId = null;
    let userRoles = [];

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
      const [username, password] = decoded.split(':');
      const userDef = users[username];
      if (userDef && (userDef.password === password || !userDef.password)) {
        userId = username;
        userRoles = userDef.roles || [];
      }
    }

    if (!userId) {
      res.set('WWW-Authenticate', 'Basic realm="Northwind Order Hub"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    res.json({
      user: userId,
      roles: {
        SalesRep: userRoles.includes('SalesRep'),
        SalesManager: userRoles.includes('SalesManager'),
        BillingClerk: userRoles.includes('BillingClerk')
      }
    });
  });
});

module.exports = cds.server;
