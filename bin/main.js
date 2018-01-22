#!/usr/bin/env node

const path = require('path');
const _ = require('lodash');
const commander = require('commander');
const fs = require('fs');
const validator = require('../lib/validator');
const git = require('../lib/git');
const render = require('../lib/render');
const files = require('../lib/files');
const log = require('../lib/log');

/**
 * Run the main program.
 * @param {string} owner GitHub owner
 * @param {string} repo GitHub repo
 * @param {string} token GitHub token
 * @param {string} dir Git directory
 * @param {string} output Write directory
 * @param {number} rotate Number of files to keep
 * @param {RegExp} issueRegex Regex to match external issues
 * @param {string} tag Name to start from
 * @param {string} tagFormat The format of what tags to get
 * @param {Array} externalLabels External commit labels
 * @param {Array} localLabels Local commit labels
 * @param {Object} render Render functions.
 * @param {string} extension The extension for the files.
 * @returns {Promise<void>}
 */
async function main({ owner, repo, token, dir, output, rotate, issueRegex, tag, tagFormat, externalLabels, localLabels, render, extension }) {
    log.progress(`Loading ${dir}`);

    // Get all tags.
    const { commits, from: fromTag } = await git.read({ dir, tag, tagFormat });

    log.success(`Found tag ${fromTag.name} ${fromTag.date}`);
    log.success(`With ${commits.length} commits`);

    const { groupedCommits, issues } = await git.retrieve({
        commits,
        issueRegex,
        owner,
        repo,
        token,
        externalLabels,
        localLabels
    });

    for (let i = 0; i < groupedCommits.length; ++i) {
        const { commits, name } = groupedCommits[i];
        log.success(`${commits.length} ${name} fixed`);
    }

    const { name: version, date } = fromTag;

    const data = render.all({
        version,
        date,
        issues,
        groupedCommits,
        render
    });

    log.progress(`\n---\n${data}\n---`);

    if (output) {
        const unixTs = new Date(date).getTime();
        const pathname = path.resolve(`${output}/${unixTs}-${version}${extension}`);
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
        console.error(`configuration file ${resolvedPathname} needs to be a valid js file`);
        process.exit(1);
    };
    if (!pathname.endsWith('.js')) {
        fail();
    }
    try {
        // eslint-disable-next-line import/no-dynamic-require
        const data = require(resolvedPathname);
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
 * @returns {Object} Parsed args.
 */
function parseCmd(argv) {
    commander
        .version('0.1.0')
        .option('--config [value]', 'configuration file in js')
        .option('--dir <value>', 'read commits and tags from this local git directory')
        .option('--upstream <value>', 'GitHub <owner>/<repo>')
        .option('--token [value]', 'GitHub token')
        .option('--output [value]', 'write the release note to this directory')
        .option('--rotate [value]', 'rotate the number of changelogs', (val) => parseInt(val, 10))
        .option('--tag [value]', 'get changelog from this tag')
        .option('--tagFormat [value]', 'get tags in this format')
        .parse(argv);

    const defaults = {
        extension: '.md',
        issueRegex: /(Fix|Close|Resolve) #(\d+)/g,
        tagFormat: 'v*',
        labels: {
            external: [{ match: 'Feature', name: 'Features' }, { match: 'Bug', name: 'Bugs' }],
            local: [{ match: /Hotfix [-~]? ?/, name: 'Others' }]
        },
        render: {
            all: render.all,
            commit: render.commit,
            group: render.group,
            version: render.version,
            combine: render.combine
        }
    };
    const configuration = _.merge({},
        defaults,
        readConfiguration(commander.config),
        _.pick(commander, ['dir', 'upstream', 'token', 'output', 'rotate', 'tag', 'tagFormat'])
    );

    const { valid, error } = validator.validate(configuration);
    if (!valid) {
        console.error(error);
        process.exit(1);
    }

    const { dir, upstream, labels, ...rest } = configuration;

    // Ensure valid git directory.
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

    return {
        ...parseGitHub(upstream),
        dir: inputDirectory,
        externalLabels: labels.external,
        localLabels: labels.local,
        ...rest
    };
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
