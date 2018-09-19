const execShell = require('execa').shell;
const _ = require('lodash');
const Octokit = require('@octokit/rest');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get local commits from git.
 * @param {string} cwd the directory to read from.
 * @param {string} from the tag to start from.
 * @param {string} to the tag to read to.
 * @returns {Promise<string>}
 */
async function getCommitsFromGit({ cwd, from, to }) {
    const { stdout } = await execShell(`git log --pretty=format:"%h %aI %s" ${from}...${to}`, { cwd });
    return stdout;
}

/**
 * Get local tags from git.
 * @param {string} cwd the directory to read from.
 * @param {number} count the number of tags to get.
 * @returns {Promise<string>}
 */
async function getLatestTagsFromGit({ cwd, count }) {
    const { stdout } = await execShell(`git log --tags --simplify-by-decoration --pretty="format:%aI %D" | grep tag: | sort -r | head -${count}`, { cwd });
    return stdout;
}

/**
 * Get an issue from GitHub.
 * @param {Object} github GitHub API instance.
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {number} number Number of the issue.
 * @returns {Promise<Object>}
 */
async function getIssueFromGitHub({ github, owner, repo, number }) {
    return github.issues.get({
        owner,
        repo,
        number
    });
}

/**
 * Get a promise function with retries.
 * @param {Function} fn
 * @param {number} retries
 * @param {number} timeout
 * @returns {Function}
 */
const getWithRetry = (fn, retries = 10, timeout = 1500) => async (...args) => {
    for (let i = 0; i < retries; ++i) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const results = await fn(...args);
            return results;
        } catch (e) {
            if (i === retries - 1) {
                throw e;
            }
            // eslint-disable-next-line no-await-in-loop
            await delay(timeout);
        }
    }
};

/**
 * Parse issue from GitHub.
 * @param {Object} issue Issue as it is from GitHub.
 * @return {{title: string, number: number, labels: array<string>}}
 */
function parseGitHubIssue(issue = {}) {
    const { number, title, labels = [] } = issue.data || {};
    const parseLabel = ({ name }) => name;
    return {
        title,
        number: parseInt(number, 10),
        labels: labels.map(parseLabel)
    };
}

/**
 * Parse issues from external source.
 * @param {Function} parser
 * @param {Array} issues
 * @return {Object} containing all issues mapped by key -> issue number.
 */
function parseIssues(parser, issues) {
    return issues.reduce((agg, issue) => {
        const { number, title, labels = [] } = parser(issue);
        agg[number] = {
            title,
            labels
        };
        return agg;
    }, {});
}

/**
 * Get two git tags from the directory.
 * If given a version, attempt to match this version and retrieve the version before it.
 * If not given a version, retrieve the newest tag and the tag before it.
 * @param {Array} tags from git.
 * @param {string} tag optional tag to start from.
 * @returns {Object}
 * @returns {{from: {name: string, date: string}, to: {name: string, date: string}}}
 */
function getTagsBetween({ tags = [], tag }) {
    // Find the tag matching the specified version, or start from the first item in the array.
    const fromIndex = tag ? tags.findIndex((t) => t.name === tag) : 0;
    // Take the next tag in the list.
    const toIndex = fromIndex + 1;
    if (fromIndex === -1 || toIndex >= tags.length) {
        return;
    }
    return {
        from: tags[fromIndex],
        to: tags[toIndex]
    };
}

/**
 * Parse a git tag.
 * ex: 2018-09-05T13:55:53+02:00 HEAD -> v3, tag: v3.14.5, origin/v3, origin/HEAD
 * ex: 2018-08-07T10:28:33+02:00 tag: v3.14.4
 * @param {RegExp} tagRegex
 */
function tagParser(tagRegex) {
    return (input = '') => {
        const regex = /([^ ]+) (.*)/;
        const result = input.match(regex);
        if (!result || result.length < 3) {
            return [];
        }
        const [, date, tags] = result;
        if (!tags) {
            return [];
        }
        return [
            ...tags
                .split(', ')
                .map((x) => x.replace('tag: ', ''))
                .filter((x) => x.match(tagRegex))
                .map((x) => ({
                    name: x,
                    date
                }))
        ];
    };
}

/**
 * Parse multiple linked GitHub issues from a git commit.
 * @param {RegExp} regex Regex matching external issues where the first group is the issue number.
 * @param {string} input
 * @returns {Array} Array of issues.
 */
function matchGithubIssues(regex, input) {
    let issuesMatch = regex.exec(input);
    const result = [];
    while (issuesMatch != null) {
        result.push(issuesMatch[2]);
        issuesMatch = regex.exec(input);
    }
    return result;
}

/**
 * Parse a git commit.
 * ex: 72d9d941d 2018-01-02T19:32:20+01:00 Fix #1129 - Error dompurify when load
 * @param {string} input Commit name.
 * @returns {Object}
 * @returns {{name: string, hash: string, date: string, issues: Array}}
 */
function commitParser(input = '') {
    const regex = /^(.{9}) ([^ ]+) (.*)/;
    const result = input.match(regex);
    if (!result || result.length < 4) {
        return;
    }
    const name = result[3];
    return {
        name,
        hash: result[1],
        date: result[2]
    };
}

/**
 * Filter commits containing a specific issue type, and map the issueNumber to the commit.
 * @param {Array} commits The list of commits from the local git history.
 * @param {Array} issues The list of issues from GitHub.
 * @param {string} match The issue label includes this text.
 * @returns {Array}
 */
function filterExternalIssues({ commits = [], issues = [], match = '' }) {
    const filterIssueType = (commitIssue) => {
        if (issues[commitIssue]) {
            return issues[commitIssue].labels.includes(match);
        }
    };
    return _.flatMap(commits, (commit) => {
        const commitIssues = commit.issues || [];
        return commitIssues
            .filter(filterIssueType)
            .map((commitIssue) => ({
                ...commit,
                issueNumber: commitIssue
            }));
    });
}

/**
 * Filter issues that do not contain linked GitHub issues.
 * @param {string} Name of the commit
 * @param {Array} issues List of linked GitHub issues.
 * @param {string} match The commit name inclues this text.
 * @returns {boolean}
 */
const filterLocalCommits = ({ name = '', issues = [], match = '' }) => {
    return issues.length === 0 && (match instanceof RegExp ? match.test(name) : name.includes(match));
};

/**
 * Remove unwanted words from a commit name.
 * @param {string} match The pattern, which is concatenated with - or ~
 * @returns {function(*)}
 */
const removeMatch = (match) => {
    return (commit) => {
        const name = commit.name.replace(match, '');
        return {
            ...commit,
            name
        };
    };
};

/**
 * Retrieves issues from the GitHub API in batches in order to avoid timeouts.
 * @param {Object} github GitHub API instance.
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {Array} issues List of issue numbers to retrieve.
 * @param {number} n Number of issues to retrieve per batch.
 * @param {number} ms Number of ms to wait before retrieving the next batch of items.
 * @param {Object} logger Logger functions.
 * @returns {Promise<Array>} Array of resolved GitHub issues.
 */
async function getIssuesFromGitHub({ github, owner, repo, issues = [], n = 5, ms = 500, logger }) {
    logger.progress(`Getting ${issues.length} issues from GitHub ${owner}/${repo}`);
    logger.progress(`Chunking ${issues.length} issues in chunks of ${n}`);

    const chunks = _.chunk(issues, n);
    const get = getWithRetry(getIssueFromGitHub);

    const result = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const chunk of chunks) {
        logger.progress(` getting ${chunk.length} issues from GitHub...`);
        result.push(
            // eslint-disable-next-line no-await-in-loop
            ...(await Promise.all(
                    chunk.map((issue) => get({ github, owner, repo, number: issue }))
                )
            )
        );

        const remaining = issues.length - result.length;
        if (remaining > 0) {
            logger.success(` getting ${remaining} more issues from GitHub...`);
            logger.progress(` waiting ${ms}ms...`);

            // eslint-disable-next-line no-await-in-loop
            await delay(ms);
        }
    }
    return result;
}

/**
 * Parse an output string, separated by newline.
 * @param {Function} parser
 * @param {string} input
 * @returns {Array}
 */
function parseOutput(parser, input = '') {
    return _.flatMap(input
        .split(/\r?\n/)
        .map(parser)
    ).filter(Boolean);
}

/**
 * Retrieves issues from GitHub.
 * @param {Array} numbers List of numbers to issues.
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {string} token GitHub token.
 * @param {Object} logger Logger functions.
 * @return {Object} containing all issues mapped by key -> issue number.
 */
async function retrieveIssuesFromGitHub({ numbers, token, owner, repo, logger }) {
    const github = new Octokit({
        timeout: 15000
    });

    if (token) {
        github.authenticate({
            type: 'token',
            token
        });
    }

    return parseIssues(parseGitHubIssue, await getIssuesFromGitHub({
        github,
        owner,
        repo,
        issues: numbers,
        logger
    }));
}

/**
 * Retrieves local commit issues from external source.
 * @param {Array} commits List of commits.
 * @param {Array} externalLabels List of GitHub label names.
 * @param {Array} localLabels Include commits not linked to a GitHub issue.
 * @param {RegExp} issueRegex Regex to match against external issue links
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {string} token GitHub token.
 * @param {Object} logger Logger functions.
 * @returns {Promise<{issues: Object, groupedCommits: Array}>}
 */
async function retrieve({ commits, issueRegex, externalLabels, localLabels, owner, repo, token, logger }) {
    const commitsWithIssues = commits.map((commit) => ({
        ...commit,
        issues: matchGithubIssues(issueRegex, commit.name)
    }));

    // Get issues from GitHub.
    const numbers = _.flatMap(commitsWithIssues, (c) => c.issues);

    // TODO: Add support for GitLab
    const issues = await retrieveIssuesFromGitHub({ numbers, repo, owner, token, logger });

    // Return the commits together with the label name.
    const resultify = (labels) => (commits, i) => ({
        commits,
        name: labels[i].name
    });

    // Filter the commits linked to GitHub issues with a specific label.
    const githubCommits =
        externalLabels
            .map((label) => filterExternalIssues({
                    commits: commitsWithIssues,
                    issues,
                    match: label.match
                })
            )
            .map((resultify(externalLabels)));

    // Filter the commits not linked to any issue.
    const localCommits =
        localLabels
            .map((label) => commits
                .filter((commit) => filterLocalCommits({
                    name: commit.name,
                    issues: commit.issues,
                    match: label.match
                }))
                .map(removeMatch(label.match))
            )
            .map((resultify(localLabels)));

    return {
        issues,
        groupedCommits: [].concat(githubCommits, localCommits)
    };
}

/**
 * Reads the tags and commits from a local git repo.
 * @param {string} dir
 * @param {string} tag
 * @param {RegExp} tagRegex
 * @returns {Promise<{commits: Array, from: {name: string, date: string}}>}
 */
async function read({ dir, tag, tagRegex }) {
    // Get and parse tags.
    const tags = parseOutput(tagParser(tagRegex), await getLatestTagsFromGit({
        cwd: dir,
        count: 20
    }));
    if (tags.length <= 1) {
        throw new Error(`Failed to get tags with ${tagRegex}`);
    }

    // Get two tags, either from a specified tag or latest tag.
    const between = getTagsBetween({
        tags,
        tag
    });
    if (!between) {
        throw new Error('Failed to get tags');
    }

    const { from: fromTag, to: toTag } = between;

    // Get all commits between the tags.
    const commits = parseOutput(commitParser, await getCommitsFromGit({
        cwd: dir,
        from: fromTag.name,
        to: toTag.name
    }));

    return {
        commits,
        from: fromTag,
        to: toTag
    };
}

module.exports = {
    read,
    retrieve
};
