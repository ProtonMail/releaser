const fs = require('fs');
const readline = require('readline');
const log = require('./log');

/**
 * Prompt the terminal to pause and read input.
 * @param {string} question
 * @returns {Promise<string>} promise resolved with the input.
 */
function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Get all written version files in order.
 * @param {Array} filenames in a directory.
 * @return {Array} array of version files in descending order.
 */
function getFilesInOrder({ files }) {
    const regex = /(\d+)?-v.*/;
    return files
        .map((name) => name.match(regex))
        .filter((match) => match && match[1])
        .map((match) => ({ date: parseInt(match[1], 10), name: match[0] }))
        .sort((a, b) => b.date - a.date);
}

/**
 * Removes version files that are to be rotated out.
 * @param {number} rotate
 * @param {string} directory
 */
function handleFileRotation({ rotate, directory }) {
    if (!fs.existsSync(directory)) {
        return;
    }
    const files = getFilesInOrder({ files: fs.readdirSync(directory) });
    const remove = files.slice(rotate).map((file) => file.name);
    if (remove.length === 0) {
        return;
    }
    log.progress(`Rotating ${remove.length} file(s)`);
    // eslint-disable-next-line no-restricted-syntax
    for (const file of remove) {
        fs.unlinkSync(file);
        log.success(`File ${file} removed`);
    }
}

/**
 * Writes data to a specified file in a directory. Prompts the terminal in case the directory does not
 * exist or the file already exists.
 * @param {string} pathname
 * @param {string} directory
 * @param {string} data to write
 * @returns {Promise<void>}
 */
async function handleFileOutput({ pathname, directory, data }) {
    // Check if the directory does not exist.
    if (!fs.existsSync(directory)) {
        log.error(`Directory ${directory} does not exist. `);
        const create = await ask('Do you want to create it? [y/n]\n');
        if (create === 'n') {
            log.success('Exiting gracefully');
            return;
        }
        fs.mkdirSync(directory);
    }

    let write = true;
    // Check if the file already exists.
    if (fs.existsSync(pathname)) {
        log.error(`File ${pathname} already exists. `);
        const replace = await ask('Are you sure you want to replace it? [y/n]\n');
        if (replace === 'n') {
            write = false;
        }
    }
    if (write) {
        log.progress(`Writing markdown file containing changes to file ${pathname}`);
        fs.writeFileSync(pathname, data);
        log.success(`File written to ${pathname}`);
    }
}

module.exports = {
    handleFileRotation, handleFileOutput
};
