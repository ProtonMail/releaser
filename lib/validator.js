const Ajv = require('ajv');

const labelSchema = {
    type: 'object',
    properties: {
        match: { anyOf: [{ type: 'string' }, { instanceof: 'RegExp' }] },
        name: { type: 'string' }
    },
    required: ['match', 'name'],
    additionalProperties: false
};

const labelsSchema = {
    type: 'object',
    properties: {
        external: { type: 'array', items: labelSchema },
        local: { type: 'array', items: labelSchema }
    },
    additionalProperties: false
};

const renderSchema = {
    type: 'object',
    properties: {
        all: { instanceof: 'Function' },
        commit: { instanceof: 'Function' },
        version: { instanceof: 'Function' },
        group: { instanceof: 'Function' },
        combine: { instanceof: 'Function' }
    },
    additionalProperties: false
};

const schema = {
    type: 'object',
    properties: {
        dir: { type: 'string' },
        upstream: { type: 'string' },
        issueRegex: { instance: 'RegExp' },
        token: { type: 'string' },
        verbosity: { type: 'integer' },
        tag: { type: 'string' },
        tagRegex: { instance: 'RegExp' },
        labels: labelsSchema,
        render: renderSchema
    },
    required: ['dir', 'upstream', 'render'],
    additionalProperties: false
};

const ajv = new Ajv();
const CLASSES = {
    RegExp: RegExp,
    Function: Function
};

ajv.addKeyword('instanceof', {
    compile: function (schema) {
        const Class = CLASSES[schema];
        return function (data) {
            return data instanceof Class;
        };
    }
});

const validate = (configuration) => {
    const validate = ajv.compile(schema);
    const valid = validate(configuration);
    return {
        valid,
        error: !valid ? ajv.errorsText(validate.errors) : undefined
    };
};

module.exports = {
    validate
};
