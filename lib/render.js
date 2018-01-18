const _ = require('lodash');

function renderChange({ hash, title, issueNumber, name }) {
    // eslint-disable-next-line no-mixed-operators
    const issue = (number) => number && `#${number} ` || '';
    return `* (${hash}) ${issue(issueNumber)}${title || name}`;
}

function renderType({ commits, type, issues }) {
    if (commits.length === 0) {
        return [];
    }
    const renderedCommits = commits.map((commit) => renderChange({ ...commit, ...issues[commit.issueNumber] }));
    return [`### ${type}`, ...renderedCommits, ''];
}

function renderVersion({ version, date, labels = [], filteredCommits = [], issues = {} }) {
    const renderedTypes = _.flatMap(
        filteredCommits,
        (commits, i) => renderType({
            commits,
            type: _.capitalize(labels[i].toLowerCase()),
            issues
        })
    );
    return [
        `# ${version} - ${date}`,
        '',
        ...renderedTypes
    ].join('\n').trim();
}

module.exports = {
    renderVersion
};
