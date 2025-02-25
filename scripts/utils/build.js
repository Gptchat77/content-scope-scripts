import * as rollup from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import replace from '@rollup/plugin-replace'
import resolve from '@rollup/plugin-node-resolve'
import dynamicImportVariables from 'rollup-plugin-dynamic-import-variables'
import { runtimeInjected } from '../../src/features.js'

/**
 * This is a helper function to require all files in a directory
 */
async function getAllFeatureCode (pathName) {
    const fileContents = {}
    for (const featureName of runtimeInjected) {
        const fileName = featureName.replace(/([a-zA-Z])(?=[A-Z0-9])/g, '$1-').toLowerCase()
        const fullPath = `${pathName}/${fileName}.js`
        const code = await rollupScript(fullPath, 'runtimeChecks', false)
        fileContents[featureName] = code
    }
    return fileContents
}

/**
 * Allows importing of all features into a custom runtimeInjects export
 * @returns {import('rollup').Plugin}
 */
function runtimeInjections () {
    const customId = 'ddg:runtimeInjects'
    return {
        name: customId,
        resolveId (id) {
            if (id === customId) {
                return id
            }
            return null
        },
        async load (id) {
            if (id === customId) {
                const code = await getAllFeatureCode('src/features')
                return `export default ${JSON.stringify(code, undefined, 4)}`
            }
            return null
        }
    }
}

export async function rollupScript (scriptPath, name, supportsMozProxies = true) {
    let mozProxies = false
    // The code is using a global, that we define here which means once tree shaken we get a browser specific output.
    if (process.argv[2] === 'firefox' && supportsMozProxies) {
        mozProxies = true
    }
    const inputOptions = {
        input: scriptPath,
        plugins: [
            runtimeInjections(),
            resolve(),
            dynamicImportVariables({}),
            commonjs(),
            replace({
                preventAssignment: true,
                values: {
                    // @ts-expect-error https://app.asana.com/0/1201614831475344/1203979574128023/f
                    mozProxies
                }
            })
        ]
    }
    const outputOptions = {
        dir: 'build',
        format: 'iife',
        inlineDynamicImports: true,
        name,
        // This if for seedrandom causing build issues
        globals: { crypto: 'undefined' }
    }

    const bundle = await rollup.rollup(inputOptions)
    // @ts-expect-error https://app.asana.com/0/1201614831475344/1203979574128023/f
    const generated = await bundle.generate(outputOptions)
    return generated.output[0].code
}
