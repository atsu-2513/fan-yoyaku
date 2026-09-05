const app = require('./app');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`fan-yoyaku server listening on port ${port}`);
});
