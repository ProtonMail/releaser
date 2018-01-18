const chalk = require('chalk');

const success = (msg) => console.log(`${chalk.green('✓ ' + msg)}`);
const progress = (msg) => console.log(`${chalk.black('.')} ${msg}`);
const error = (msg) => console.log(`${chalk.magentaBright(' ⚠ ')} ${chalk.red(msg)}`);

module.exports = {
    success, progress, error
};

