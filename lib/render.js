const _ = require('lodash');

function commit({ title, hash, issueNumber, name }) {
    // eslint-disable-next-line no-mixed-operators
    const issue = (number) => number && `#${number} ` || '';
    return `* (${hash}) ${issue(issueNumber)}${title || name}`;
}

function group({ name, commits }) {
    return `### ${name}
${commits.join('\n')}
`;
}

function version({ version, date }) {
    return `# ${version}
${date}
`;
}

function combine({ version, groups }) {
    return [
        version,
        ...groups
    ].join('\n').trim();
}

function all({ version, date, groupedCommits = [], issues = {}, render }) {
    const renderedGroups = groupedCommits
        .filter((group) => group.commits.length > 0)
        .map((group) => render.group({
                commits: group.commits.map((commit) => render.commit({ ...commit, ...issues[commit.issueNumber] })),
                name: group.name
            })
        );
    return render.combine({
        version: render.version({ version, date }),
        groups: renderedGroups
    });
}

module.exports = {
    version,
    group,
    commit,
    combine,
    all
};
