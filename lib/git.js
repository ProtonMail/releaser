const exec = require('child-process-promise').exec;
const _ = require('lodash');
const log = require('../lib/log');
const GitHubApi = require('github');

/**
 * Get local commits from git.
 * @param {string} cwd the directory to read from.
 * @param {string} from the tag to start from.
 * @param {string} to the tag to read to.
 * @returns {Promise<string>}
 */
async function getCommitsFromGit({ cwd, from, to }) {
    const { stdout } = await exec(`git log --pretty=format:"%h %aI %s" ${from}...${to}`, { cwd });
    return stdout;
}

/**
 * Get local tags from git.
 * @param {string} cwd the directory to read from.
 * @param {number} count the number of tags to get.
 * @param {string} type the format of the tag.
 * @returns {Promise<string>}
 */
async function getLatestTagsFromGit({ cwd, count, type = '' }) {
    const { stdout } = await exec(`git for-each-ref --sort=-taggerdate --format '%(refname) %(taggerdate:iso-strict)' --count=${count} 'refs/tags/${type}'`, { cwd });
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
 * ex: refs/tags/v3.12.21 2017-12-23T14:38:07+01:00
 * @param {string} input
 * @returns {{name: string, date: string}}
 */
function tagParser(input = '') {
    const regex = /refs\/tags\/([^ ]+) (.*)/;
    const result = input.match(regex);
    if (!result) {
        return;
    }
    const [, tag, date] = result;
    return {
        name: tag,
        date
    };
}

/**
 * Parse multiple linked GitHub issues from a git commit.
 * @param {string} input
 * @returns {Array} Array of issues.
 */
function matchGithubIssues(input = '') {
    const regex = /(Fix|Close|Resolve) #(\d+)/g;
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
    const issues = matchGithubIssues(name);
    return {
        name,
        hash: result[1],
        date: result[2],
        issues
    };
}

/**
 * Filter commits containing a specific issue type, and map the issueNumber to the commit.
 * @param {Array} commits The list of commits from the local git history.
 * @param {Array} issues The list of issues from GitHub.
 * @param {string} type The issue label includes this type.
 * @returns {Array}
 */
function filterIssues({ commits = [], issues = [], type = '' }) {
    const filterIssueType = (commitIssue) => {
        if (issues[commitIssue]) {
            return issues[commitIssue].labels.includes(type);
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
 * @param {string} name of the commit
 * @param {Array} issues list of linked GitHub issues.
 * @returns {boolean}
 */
const filterOthers = ({ name = '', issues = [] }) => {
    const noIssues = issues.length === 0;
    const noText = /Merge|i18n/.test(name);
    const withText = /Hotfix/.test(name);
    return noIssues && !noText && withText;
};

/**
 * Remove unwanted words from a commit name.
 * @param commit
 * @returns {{name: string|*|void}}
 */
const replaceName = (commit) => {
    const name = commit.name.replace(/Hotfix [-~]? ?/, '');
    return {
        ...commit,
        name
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
 * @returns {Promise<Array>} Array of resolved GitHub issues.
 */
async function getIssuesFromGitHub({ github, owner, repo, issues = [], n = 5, ms = 500 }) {
    log.progress(`Getting ${issues.length} issues from GitHub ${owner}/${repo}`);
    log.progress(`Chunking ${issues.length} issues in chunks of ${n}`);

    const chunks = _.chunk(issues, n);
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const result = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const chunk of chunks) {
        log.progress(` getting ${chunk.length} issues from GitHub...`);
        result.push(
            // eslint-disable-next-line no-await-in-loop
            ...(await Promise.all(
                    chunk.map((issue) => getIssueFromGitHub({ github, owner, repo, number: issue }))
                )
            )
        );

        const remaining = issues.length - result.length;
        if (remaining > 0) {
            log.success(` getting ${remaining} more issues from GitHub...`);
            log.progress(` waiting ${ms}ms...`);

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
    return input
        .split(/\r?\n/)
        .map(parser)
        .filter(Boolean);
}

/**
 * Retrieves issues from GitHub.
 * @param {Array} numbers List of numbers to issues.
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {string} token GitHub token.
 * @return {Object} containing all issues mapped by key -> issue number.
 */
async function retrieveIssuesFromGitHub({ numbers, token, owner, repo }) {
    const github = new GitHubApi({
        timeout: 7000
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
        issues: numbers
    }));
}

/**
 * Retrieves local commit issues from external source.
 * @param {Array} commits List of commits.
 * @param {Array} labels List of GitHub label names.
 * @param {string} owner Name of owner.
 * @param {string} repo Name of repo.
 * @param {string} token GitHub token.
 * @param {number} others Include commits not linked to a GitHub issue.
 * @returns {Promise<{issues: Object, filteredCommits: Array}>}
 */
async function retrieve({ commits, labels, owner, repo, token, others }) {
    // Get issues from GitHub.
    const numbers = _.flatMap(commits, (c) => c.issues);

    // TODO: Add support for GitLab
    const issues = await retrieveIssuesFromGitHub({ numbers, repo, owner, token });

    // Filter the commits linked to GitHub issues with a specific label.
    const filteredCommits = labels.map((label) => filterIssues({
        commits,
        issues,
        type: label
    }));

    if (others) {
        // Add other commits which have not been linked to any issue.
        filteredCommits.push(
            commits
                .filter(filterOthers)
                .map(replaceName)
        );
        labels.push('Other');
    }

    return {
        issues,
        filteredCommits
    };
}

/**
 * Reads the tags and commits from a local git repo.
 * @param {string} dir
 * @param {string} tag
 * @param {string} tagFormat
 * @returns {Promise<{commits: Array, from: {name: string, date: string}}>}
 */
async function read({ dir, tag, tagFormat }) {
    // Get and parse tags.
    const tags = parseOutput(tagParser, await getLatestTagsFromGit({
        cwd: dir,
        count: 20,
        type: tagFormat
    }));
    if (tags.length <= 1) {
        throw new Error(`Failed to get tags with ${tagFormat}`);
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
        from: fromTag
    };
}

module.exports = {
    read,
    retrieve
};
