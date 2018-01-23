const chalk = require('chalk');

const Logger = ({ level }) => {
    const noop = () => {
    };

    const progress = level >= 2 ? (msg) => console.log(`${chalk.black('.')} ${msg}`) : noop;
    const success = level >= 3 ? (msg) => console.log(`${chalk.green('✓ ' + msg)}`) : noop;
    const error = level >= 1 ? (msg) => console.log(`${chalk.magentaBright(' ⚠ ')} ${chalk.red(msg)}`) : noop;

    return {
        success,
        progress,
        error
    };
};

module.exports = Logger;
