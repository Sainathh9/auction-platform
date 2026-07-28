// Shared atomic counter across all Artillery Virtual Users
let currentHighestBid = 100;

function generateEscalatingBid(userContext, events, done) {
  // Monotonically increment bid (+1 to +5) so Redis atomic Lua script accepts it as a winning bid
  currentHighestBid += Math.floor(Math.random() * 5) + 1;
  userContext.vars.bidAmount = currentHighestBid;

  // Rotate user IDs dynamically per bid
  userContext.vars.userId = `usr_${Math.floor(Math.random() * 10000)}`;

  return done();
}

module.exports = {
  generateEscalatingBid
};
