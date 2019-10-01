#!/usr/bin/env node

const path = require('path');
const _ = require('lodash');
const commander = require('commander');
const fs = require('fs');
const validator = require('../lib/validator');
const git = require('../lib/git');
const render = require('../lib/render');
const Logger = require('../lib/logger');
const semver = require('semver');

/**
 * Run the main program.
 * @param {string} owner GitHub owner
 * @param {string} repo GitHub repo
 * @param {string} token GitHub token
 * @param {string} dir Git directory
 * @param {RegExp} issueRegex Regex to match external issues
 * @param {string} tag Name to start from
 * @param {RegExp} tagRegex Regex to tags
 * @param {Array} externalLabels External commit labels
 * @param {Array} localLabels Local commit labels
 * @param {Object} render Render functions.
 * @param {Object} logger Logger functions.
 * @returns {Promise<void>}
 */
async function main({ owner, repo, token, dir, issueRegex, tag, tagRegex, externalLabels, localLabels, render, logger, type = 'patch' }) {
    logger.progress(`Loading ${dir}`);

    // Get all tags.
    const { commits, from: fromTag, to: toTag } = await git.read({ dir, tag, tagRegex });
    const [, currentTag ] = fromTag.name.split('v');
    const nextVersion = semver.inc(currentTag, type);

    logger.success(`Found tags from ${fromTag.name} ${fromTag.date} to ${toTag.name} ${toTag.date}`);
    logger.success(`With ${commits.length} commits`);

    const { groupedCommits, issues } = await git.retrieve({
        commits,
        issueRegex,
        owner,
        repo,
        token,
        externalLabels,
        localLabels,
        logger
    });

    for (let i = 0; i < groupedCommits.length; ++i) {
        const { commits, name } = groupedCommits[i];
        logger.success(`${commits.length} ${name} fixed`);
    }

    const { date } = fromTag;

    const data = render.all({
        version: `v${nextVersion}`,
        date,
        issues,
        groupedCommits,
        render
    });

    process.stdout.write(data);
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
        .option('--verbosity [value]', 'verbosity level', (val) => parseInt(val, 10))
        .option('--tag [value]', 'get changelog from this tag')
        .parse(argv);

    const defaults = {
        issueRegex: /(Fix|Close|Resolve) #(\d+)/g,
        tagRegex: /v\d+.\d+.\d+/,
        labels: {
            external: [{ match: 'Feature', name: 'Features' }, { match: 'Bug', name: 'Bugs' }],
            local: [{ match: /Hotfix [-~]? ?/, name: 'Others' }]
        },
        verbosity: 3,
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
        _.pick(commander, ['dir', 'upstream', 'token', 'rotate', 'tag', 'tagRegex', 'verbosity'])
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

    // eslint-disable-next-line new-cap
    const logger = Logger({ level: configuration.verbosity });

    return {
        logger,
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
            console.error(`Failed connecting to GitHub: ${e.message}`);
        } else {
            console.error(e.message);
        }
        console.error(e);
        process.exit(1);
    });
