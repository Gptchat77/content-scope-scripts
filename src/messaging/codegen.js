import Ajv from 'ajv'
import standalone from 'ajv/dist/standalone/index.js'
import { formatArrayMembers, formatUnionMembers } from './codegen-utils.js'
import { printJs } from './codegen-printers.js'

/**
 * @typedef {{json: import('json-schema').JSONSchema7, relative: string}} Input
 * @typedef {{name: string, type: string[], required?: boolean, description?: string, title?: string}} Member
 * @typedef {{name: string, members: Member[], source: string, description?: string, title?: string}} Interface
 * @typedef {{interfaces: Interface[], input: Input}} Group
 */

/**
 * @param {Input[]} inputs
 */
export function parse (inputs) {
    /**
     * @param {object} args;
     * @param {import('json-schema').JSONSchema7} args.value;
     * @param {string} args.propName;
     * @param {string} args.ident;
     * @param {Input} args.input;
     * @param {string} args.parentName;
     * @param {string} args.topName;
     * @param {string[]} [args.localRefs]
     * @param {string} [args.identPrefix]
     * @returns {Member[]}
     */
    function processObject (args) {
        const { value, propName, ident, input, identPrefix, localRefs, topName } = args
        /** @type {Member[]} */
        const members = []
        switch (value.type) {
        case 'string': {
            if (value.const) {
                members.push({
                    name: propName,
                    type: [JSON.stringify(value.const)],
                    title: value.title,
                    description: value.description
                })
            } else if (value.enum) {
                members.push({
                    name: propName,
                    type: [value.enum.map(x => JSON.stringify(x)).join(' | ')],
                    title: value.title,
                    description: value.description
                })
            } else { // base case
                members.push({
                    name: propName,
                    type: ['string'],
                    title: value.title,
                    description: value.description
                })
            }
            break
        }
        case 'number': {
            members.push({ name: propName, type: ['number'] })
            break
        }
        case 'boolean': {
            members.push({ name: propName, type: ['boolean'] })
            break
        }
        case 'object': {
            if (Array.isArray(value.oneOf)) {
                const unionMembers = []
                for (const oneOfElement of value.oneOf) {
                    if (typeof oneOfElement === 'boolean') {
                        continue
                    }
                    if (oneOfElement?.$ref) {
                        const name = oneOfElement.$ref.slice(14)
                        unionMembers.push(name)
                    } else {
                        console.log('not Supported', value.oneOf)
                    }
                }
                members.push({ name: propName, type: [formatUnionMembers(unionMembers)], description: value.description })
            } else {
                if (ident) {
                    members.push({ name: propName, type: [ident] })
                    processOne({ json: value, input: input, topName })
                } else {
                    if (propName === 'success') {
                        processOne({ json: value, input: input, topName })
                    } else {
                        console.log('missing props', value)
                    }
                }
            }
            break
        }
        case 'array': {
            const arrayMembers = []
            if (typeof value.items === 'boolean') {
                /** noop */
            } else if (Array.isArray(value.items)) {
                /** noop */
            } else {
                if (value.items?.$ref) {
                    const name = value.items?.$ref.slice(14)
                    arrayMembers.push(name)
                } else {
                    arrayMembers.push('any')
                }
                members.push({ name: propName, type: [formatArrayMembers(arrayMembers)] })
            }
        }
        }

        if (!value.type) {
            if (value?.$ref) {
                let name = identName(value.$ref)
                if (localRefs?.includes(name)) {
                    name = args.parentName + name
                }
                members.push({ name: propName, type: [name] })
            } else {
                console.log('object property without type or ref', value)
            }
        }

        return members

        /**
         * @param {string} value
         * @returns {string}
         */
        function identName (value) {
            const name = value.slice(14)
            if (identPrefix) {
                return identPrefix + name
            }
            return name
        }
    }

    /**
     * @param {object} args
     * @param {Input} args.input
     * @param {Record<string, any>} args.json
     * @param {string} args.topName
     * @param {string} [args.knownId]
     * @param {string} [args.identPrefix]
     * @param {string[]} [args.localRefs]
     * @returns {Interface[]}
     */
    /** @type {Interface[]} */
    let interfaces = []

    function processOne (args) {
        const { json, input, knownId, identPrefix, localRefs, topName } = args
        if (!json.$id && !knownId) {
            console.log('no json.$id or knownId', json)
            return interfaces
        }
        if (!knownId && !json.$id.startsWith('#/definitions/')) {
            console.log('cannot find name')
            return interfaces
        }
        const parentName = knownId || json.$id?.slice(14)
        if (!parentName) {
            throw new Error('unreachable name should exist')
        }
        /** @type {Member[]} */
        const members = []
        const hasProps = Boolean(json.properties)
        const isObject = json.type === 'object'
        if (hasProps) {
            for (const [propName, value] of Object.entries(json.properties || {})) {
                const required = json.required?.includes(propName)
                const thisId = value?.$id?.slice(14)
                const inner = processObject({
                    value: value,
                    propName: propName,
                    ident: thisId,
                    input: input,
                    identPrefix,
                    localRefs,
                    parentName,
                    topName
                })
                members.push(...inner.map(x => ({ ...x, required })))
            }
        } else {
            if (isObject) {
                if (json.additionalProperties) {
                    if (typeof json.additionalProperties === 'boolean') {
                        members.push({ name: '[index: string]', type: ['unknown'], required: true })
                    } else {
                        if (json.additionalProperties.$ref) {
                            // members.push()
                            let topName = json.additionalProperties.$ref?.slice(14)
                            if (identPrefix) {
                                topName = identPrefix + topName
                            }
                            members.push({ name: '[index: string]', type: [topName], required: true })
                        }
                    }
                }
            }
        }
        if (json.definitions) {
            for (const [defName, defValue] of Object.entries(json.definitions)) {
                const ident = parentName + defName
                processOne({ json: defValue, input: input, knownId: ident, identPrefix: parentName, localRefs, topName })
            }
        }
        interfaces.push({
            name: parentName,
            members,
            source: input.relative,
            description: json.description,
            title: parentName !== json.title ? json.title : undefined
        })
    }

    /** @type {Group[]} */
    const groups = []

    for (const input of inputs) {
        const topRefs = Object.keys(input.json.definitions || {})
        const topName = input.json.$id?.slice(14)
        if (!topName) {
            throw new Error('unreachable')
        }
        processOne({ json: input.json, input: input, localRefs: topRefs, topName })
        groups.push({ input, interfaces: interfaces.slice().reverse() })
        interfaces = []
    }

    const ajv = new Ajv({ schemas: inputs.map(x => x.json), code: { source: true }, strict: false })
    const moduleCode = standalone(ajv)
    return { validators: '// @ts-nocheck\n' + moduleCode, types: printJs(groups) }
}
