#!/usr/bin/env node

const path = require('path');
const _ = require('lodash');
const commander = require('commander');
const fs = require('fs');
const git = require('../lib/git');
const render = require('../lib/render');
const files = require('../lib/files');
const log = require('../lib/log');

/**
 * Run the main program.
 * @param {string} owner GitHub owner
 * @param {string} repo GitHub repo
 * @param {string} token GitHub token
 * @param {string} dir git directory
 * @param {string} output write directory
 * @param {number} rotate number of files to keep
 * @param {string} tag name to start from
 * @param {string} tagFormat the format of what tags to get
 * @param {Array} labels GitHub issues
 * @param {number} others
 * @returns {Promise<void>}
 */
async function main({ owner, repo, token, dir, output, rotate, tag, tagFormat, labels, others }) {
    log.progress(`Loading ${dir}`);

    // Get all tags.
    const { commits, from: fromTag } = await git.read({ dir, tag, tagFormat });

    log.success(`Found tag ${fromTag.name} ${fromTag.date}`);
    log.success(`With ${commits.length} commits`);

    const { filteredCommits, issues } = await git.retrieve({ commits, owner, repo, token, labels, others });

    for (let i = 0; i < labels.length; ++i) {
        log.success(`${filteredCommits[i].length} ${labels[i]} fixed`);
    }

    const { name: version, date } = fromTag;

    const data = render.renderVersion({
        version,
        date,
        issues,
        labels,
        filteredCommits
    });

    log.progress(`\n---\n${data}\n---`);

    if (output) {
        const unixTs = new Date(date).getTime();
        const pathname = path.resolve(`${output}/${unixTs}-${version}`);
        const directory = path.dirname(pathname);

        await files.handleFileOutput({ data, pathname, directory });
        if (rotate > 0) {
            await files.handleFileRotation({ rotate, directory });
        }
    }
}

/**
 * Reads a configuration file from a specified pathname.
 * @param {string} pathname
 * @returns {Object}
 */
function readConfiguration(pathname) {
    if (!pathname) {
        return {};
    }
    const resolvedPathname = path.resolve(pathname);
    const fail = () => {
        console.error(`configuration file ${resolvedPathname} needs to be a valid JSON file`);
        process.exit(1);
    };
    if (!pathname.endsWith('.json')) {
        fail();
    }
    try {
        const data = JSON.parse(fs.readFileSync(resolvedPathname, 'utf8'));
        if (!_.isObject(data)) {
            fail();
        }
        return data;
    } catch (e) {
        fail();
    }
}

/**
 * Parses a list of arguments.
 * @param {Array} argv
 * @returns {{owner: string, repo: string, token: string, dir: string, output: string, rotate: number, tag: string, tagFormat: string, labels: string[], others: number}}
 */
function parseCmd(argv) {
    commander
        .version('0.1.0')
        .option('--config [value]', 'configuration file in json')
        .option('--dir <value>', 'read commits and tags from this local git directory')
        .option('--upstream <value>', 'GitHub <owner>/<repo>')
        .option('--token [value]', 'GitHub token')
        .option('--output [value]', 'write the release note to this directory')
        .option('--rotate [value]', 'rotate the number of changelogs', parseInt)
        .option('--tag [value]', 'get changelog from this tag')
        .option('--tagFormat [value]', 'get tags in this format')
        .parse(argv);

    const configuration = readConfiguration(commander.config);

    const {
        upstream,
        token,
        dir,
        output,
        rotate,
        tag,
        tagFormat = 'v*',
        labels = ['Feature', 'Bug'],
        others = 1
    } = Object.assign({}, commander, configuration);

    /**
     * Validates that every item in the required and optional arrays are of a certain type.
     * @param {Array} required
     * @param {Array} optional
     * @param {Function} validator
     * @returns {boolean}
     */
    const validateType = (required = [], optional = [], validator) => {
        return required
            .concat(optional.filter(Boolean))
            .every(validator);
    };

    if (!validateType([labels], [], _.isArray) ||
        !validateType([dir, upstream, ...labels], [token, output, tag, tagFormat], _.isString) ||
        !validateType([], [rotate, others], _.isNumber)
    ) {
        console.error(commander.helpInformation());
        process.exit(1);
    }

    const inputDirectory = path.resolve(dir);

    // The directory must exist and be valid git repo, otherwise we can't read it.
    if (!fs.existsSync(inputDirectory) || !fs.existsSync(`${inputDirectory}/.git`)) {
        console.error(`${inputDirectory} does not exist, or is not a valid git repo.`);
        process.exit(1);
    }

    // Ensure valid GitHub repo.
    const parseGitHub = (upstream = '') => {
        const splitted = upstream.split('/');
        if (splitted.length !== 2) {
            console.error(`${upstream} invalid GitHub repo.`);
            process.exit(1);
        }
        return { owner: splitted[0], repo: splitted[1] };
    };

    return { ...parseGitHub(upstream), token, dir: inputDirectory, output, rotate, tag, tagFormat, labels, others };
}

main(parseCmd(process.argv))
    .catch((e) => {
        if (e.code && e.code === '504') {
            log.error(`Failed connecting to GitHub: ${e.message}`);
        } else {
            log.error(e.message);
        }
        console.log(e);
        process.exit(1);
    });
