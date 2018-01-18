# releaser

A release note generator that reads and parses git commits and retrieves issue links from GitHub.

## Usage

`releaser --dir <directory> --upstream <owner>/<repo> --token <token>`

## Arguments

```
--config [value]     configuration file in json
--dir <value>        read commits and tags from this local git directory
--upstream <value>   GitHub <owner>/<repo>
--token <value>      GitHub token
--output [value]     write the release note to this directory
--rotate [value]     rotate the number of changelogs
--tag [value]        get changelog from this tag
--tagFormat [value]  get tags in this format
-h, --help           output usage information
```

## Git
By default, it expects the commits and tags to follow a specific format.

### Tags
Tags are expected to follow the semver convention as `v1.0.0`. It is customizable through the `tagFormat` parameter.

### Commits
Commits are expected to follow the following convention:

* `/(Fix|Close|Resolve) #(\d+)/g `: A commit name that matches this regex will automatically be resolved to the corresponding GitHub issue with the title of the issue as the name of the change.
* `Hotfix - Message`: A commit name that starts with `Hotfix` will get included as `others` with Message as the name of the change.

### Issue labels
By default, only issues that contain the labels `[Bug, Feature]` will be included in the release notes. This is customizable through the `labels` parameter.

## Author

Mattias Svanström (@mmso) - ProtonMail
