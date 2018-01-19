const _ = require('lodash');

function renderChange({ title, issueNumber, name }) {
    // eslint-disable-next-line no-mixed-operators
    const issue = (number) => number && `#${number} ` || '';
    return `* ${issue(issueNumber)}${title || name}`;
}

function renderType({ commits, type, issues }) {
    if (commits.length === 0) {
        return [];
    }
    const renderedCommits = commits.map((commit) => renderChange({ ...commit, ...issues[commit.issueNumber] }));
    return [`### ${type}`, ...renderedCommits, ''];
}

function renderVersion({ version, date, groupedCommits = [], issues = {} }) {
    const renderedTypes = _.flatMap(
        groupedCommits,
        (group) => renderType({
            commits: group.commits,
            type: group.name,
            issues
        })
    );
    return [
        `# ${version}`,
        `*${date}*`,
        '',
        ...renderedTypes
    ].join('\n').trim();
}

module.exports = {
    renderVersion
};
