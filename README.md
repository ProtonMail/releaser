# releaser

A release note generator that reads and parses git commits and retrieves issue links from GitHub.

## Usage

`releaser --dir <directory> --upstream <owner>/<repo> --token <token>`

## Arguments

```
--config [value]     configuration file in js
--dir <value>        read commits and tags from this local git directory
--upstream <value>   GitHub <owner>/<repo>
--token <value>      GitHub token
--tag [value]        get changelog from this tag
-h, --help           output usage information
```

## Git
By default, it expects the commits and tags to follow a specific format.

### Tags
Tags are expected to follow the semver convention as `v1.0.0`. It is customizable through the `tagRegex` configuration option.

### Commits
Commits are expected to follow the following convention:

* `/(Fix|Close|Resolve) #(\d+)/g `: A commit name that matches this regex will automatically be resolved to the corresponding GitHub issue with the title of the issue as the name of the change. This is overridable through the `issueRegex` parameter in a configuration file.
* `Hotfix - Message`: A commit name that starts with `Hotfix` will get included as `others` with Message as the name of the change. This is customisable through the `labels > local` parameter in a configuration file.

### Issue labels
By default, only issues that contain the labels `[Bug, Feature]` will be included in the release notes. This is customisable through the `externalLabels` parameter in a configuration file.

## Render
By default, the changelog is rendered in markdown. It is possible to override the rendering functions through the configuration file.

## Configuration
Example `releaser.config.js`:

```javascript
module.exports = {
    upstream: 'ProtonMail/WebClient',
    dir: '.',
    rotate: 5,
    tagRegex: 'v\d+.\d+.\d+',
    labels: {
        external: [{ match: 'Enchancement', name: 'Features' }, { match: 'Bug', name: 'Bugs' }],
        local: [{ match: /Hotfix [-~]? ?/, name: 'Others' }]
    },
    render: {
        commit: function commit({ title, issueNumber, name }) {
            const issue = (number) => number && `#${number} ` || '';
            return `* ${issue(issueNumber)}${title || name}`;
        }
    }
};

```

## Author

Mattias Svanström (@mmso) - ProtonMail
