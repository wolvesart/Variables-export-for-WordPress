// code.js - Figma plugin with variable usage detection

console.log('Plugin started');

figma.showUI(__html__, { width: 460, height: 650 });

// Synthetic collection id representing Figma text & effect styles (which live
// outside variable collections). When it isn't selected, styles are not exported.
var STYLES_COLLECTION_ID = 'styles';

// Send initial stats when plugin loads
async function sendInitialStats() {
    try {
        var localVariables = await figma.variables.getLocalVariablesAsync();
        var collections = await figma.variables.getLocalVariableCollectionsAsync();

        // Type counts (cheap — no document traversal needed)
        var colors = 0;
        var numbers = 0;
        var strings = 0;
        var booleans = 0;

        for (var i = 0; i < localVariables.length; i++) {
            var variable = localVariables[i];
            if (variable.resolvedType === 'COLOR') colors++;
            else if (variable.resolvedType === 'FLOAT') numbers++;
            else if (variable.resolvedType === 'STRING') strings++;
            else if (variable.resolvedType === 'BOOLEAN') booleans++;
        }

        // Build collections array with id and name
        var collectionsArray = [];
        for (var c = 0; c < collections.length; c++) {
            collectionsArray.push({
                id: collections[c].id,
                name: collections[c].name
            });
        }

        // Add a synthetic "Styles" collection for text & effect styles, which live
        // outside variable collections. Deselecting it excludes them from the export.
        var localTextStyles = await figma.getLocalTextStylesAsync();
        var localEffectStyles = await figma.getLocalEffectStylesAsync();
        if (localTextStyles.length > 0 || localEffectStyles.length > 0) {
            collectionsArray.push({ id: STYLES_COLLECTION_ID, name: 'Styles' });
        }

        // Build variable groups (first segment of variable name)
        var groupsMap = {};
        for (var v = 0; v < localVariables.length; v++) {
            var variable = localVariables[v];
            var nameParts = variable.name.split('/');
            var groupName = nameParts[0].trim();

            // Find collection name
            var collectionName = '';
            for (var col = 0; col < collections.length; col++) {
                if (collections[col].id === variable.variableCollectionId) {
                    collectionName = collections[col].name;
                    break;
                }
            }

            // Create unique key for group (collection + group name)
            var groupKey = variable.variableCollectionId + '/' + groupName;

            if (!groupsMap[groupKey]) {
                groupsMap[groupKey] = {
                    id: groupKey,
                    name: groupName,
                    collectionId: variable.variableCollectionId,
                    collectionName: collectionName,
                    types: new Set()
                };
            }
            groupsMap[groupKey].types.add(variable.resolvedType);
        }

        // Convert to array and convert Sets to arrays
        var variableGroups = [];
        var groupKeys = Object.keys(groupsMap);
        for (var g = 0; g < groupKeys.length; g++) {
            var group = groupsMap[groupKeys[g]];
            variableGroups.push({
                id: group.id,
                name: group.name,
                collectionId: group.collectionId,
                collectionName: group.collectionName,
                types: Array.from(group.types)
            });
        }

        // 1) Send the lightweight stats right away so the UI renders immediately,
        //    without waiting for the expensive whole-document usage analysis.
        figma.ui.postMessage({
            type: 'initial-stats',
            stats: {
                total: localVariables.length,
                collections: collections.length,
                colors: colors,
                numbers: numbers,
                strings: strings,
                booleans: booleans
            },
            collections: collectionsArray,
            variableGroups: variableGroups
        });

        // 2) Compute variable usage in the background, then send a follow-up
        //    update that fills in the used/unused counts and the donut chart.
        var usedVariableIds = await analyzeVariableUsage();
        var usedCount = 0;
        for (var uc = 0; uc < localVariables.length; uc++) {
            if (usedVariableIds.has(localVariables[uc].id)) usedCount++;
        }

        figma.ui.postMessage({
            type: 'usage-stats',
            stats: {
                exported: usedCount,
                skipped: localVariables.length - usedCount
            }
        });
    } catch (error) {
        console.error('Error loading initial stats:', error);
    }
}

sendInitialStats();

// Convert RGBA to HEX
function rgbaToHex(color) {
    var r = Math.round(color.r * 255).toString(16).padStart(2, '0');
    var g = Math.round(color.g * 255).toString(16).padStart(2, '0');
    var b = Math.round(color.b * 255).toString(16).padStart(2, '0');

    if (color.a !== undefined && color.a < 1) {
        var a = Math.round(color.a * 255).toString(16).padStart(2, '0');
        return '#' + r + g + b + a;
    }

    return '#' + r + g + b;
}

// Normalize variable name
function normalizeVariableName(name) {
    return name
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-_]/g, '')
        .toLowerCase();
}

// Remove prefix from normalized name if it matches (e.g., "color-green-100" -> "green-100")
function removeTypePrefix(normalizedName, prefix) {
    var prefixWithDash = prefix.toLowerCase() + '-';
    if (normalizedName.startsWith(prefixWithDash)) {
        return normalizedName.substring(prefixWithDash.length);
    }
    return normalizedName;
}

// Convert font weight name to numeric value
function getFontWeightValue(styleName) {
    var styleUpper = styleName.toUpperCase();

    if (styleUpper.indexOf('THIN') !== -1 || styleUpper === '100') return '100';
    if (styleUpper.indexOf('EXTRALIGHT') !== -1 || styleUpper.indexOf('EXTRA LIGHT') !== -1 || styleUpper === '200') return '200';
    if (styleUpper.indexOf('LIGHT') !== -1 || styleUpper === '300') return '300';
    if (styleUpper.indexOf('REGULAR') !== -1 || styleUpper.indexOf('NORMAL') !== -1 || styleUpper === '400') return '400';
    if (styleUpper.indexOf('MEDIUM') !== -1 || styleUpper === '500') return '500';
    if (styleUpper.indexOf('SEMIBOLD') !== -1 || styleUpper.indexOf('SEMI BOLD') !== -1 || styleUpper === '600') return '600';
    if (styleUpper.indexOf('BOLD') !== -1 || styleUpper === '700') return '700';
    if (styleUpper.indexOf('EXTRABOLD') !== -1 || styleUpper.indexOf('EXTRA BOLD') !== -1 || styleUpper === '800') return '800';
    if (styleUpper.indexOf('BLACK') !== -1 || styleUpper.indexOf('HEAVY') !== -1 || styleUpper === '900') return '900';

    // Default to 400 if we can't determine
    return '400';
}

// Extract text styles from Figma
async function extractTextStyles() {
    console.log('Extracting text styles...');

    var textStyles = await figma.getLocalTextStylesAsync();
    var extractedStyles = [];

    for (var i = 0; i < textStyles.length; i++) {
        var style = textStyles[i];
        var nameParts = style.name.split('/');
        var folder = nameParts.length > 1 ? nameParts[0].trim() : '';
        var styleName = nameParts.length > 1 ? nameParts.slice(1).join('-').trim() : style.name;

        // Normalize name
        var normalizedFolder = folder.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
        var normalizedName = styleName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
        var fullName = normalizedFolder ? normalizedFolder + '-' + normalizedName : normalizedName;

        extractedStyles.push({
            name: style.name,
            folder: folder,
            styleName: styleName,
            normalizedName: fullName,
            normalizedFolder: normalizedFolder,
            fontFamily: style.fontName.family,
            fontSize: style.fontSize,
            fontWeight: style.fontName.style,
            fontWeightValue: getFontWeightValue(style.fontName.style),
            lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing,
            originalIndex: i
        });
    }

    console.log('Text styles extracted: ' + extractedStyles.length);
    return extractedStyles;
}

// Extract effect styles (drop/inner shadows) and turn them into CSS box-shadow values
async function extractEffectStyles() {
    console.log('Extracting effect styles...');

    var effectStyles = await figma.getLocalEffectStylesAsync();
    var shadows = [];

    for (var i = 0; i < effectStyles.length; i++) {
        var style = effectStyles[i];
        var cssLayers = [];        // for SCSS (box-shadow string)
        var structuredLayers = []; // for DTCG (shadow composite)

        for (var e = 0; e < style.effects.length; e++) {
            var eff = style.effects[e];
            if (eff.visible === false) continue;
            if (eff.type !== 'DROP_SHADOW' && eff.type !== 'INNER_SHADOW') continue;

            var isInset = eff.type === 'INNER_SHADOW';
            var x = Math.round(eff.offset.x) + 'px';
            var y = Math.round(eff.offset.y) + 'px';
            var blur = Math.round(eff.radius) + 'px';
            var spread = Math.round(eff.spread || 0) + 'px';
            var color = rgbaToHex(eff.color);
            cssLayers.push((isInset ? 'inset ' : '') + x + ' ' + y + ' ' + blur + ' ' + spread + ' ' + color);
            structuredLayers.push({ offsetX: x, offsetY: y, blur: blur, spread: spread, color: color, inset: isInset });
        }

        if (cssLayers.length === 0) continue;

        var nameParts = style.name.split('/');
        var folder = nameParts.length > 1 ? nameParts[0].trim() : '';
        var styleName = nameParts.length > 1 ? nameParts.slice(1).join('-').trim() : style.name;
        var normalizedFolder = folder.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
        var normalizedName = styleName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
        var fullName = normalizedFolder ? normalizedFolder + '-' + normalizedName : normalizedName;

        shadows.push({
            name: fullName,
            originalName: style.name,
            value: cssLayers.join(', '),
            layers: structuredLayers,
            originalIndex: i
        });
    }

    console.log('Effect styles extracted: ' + shadows.length);
    return shadows;
}

// Session cache for the variable-usage analysis.
// Traversing every node on every page (after loadAllPagesAsync) is expensive on
// large files — the Figma docs warn it causes a significant delay. We therefore
// compute it once and reuse the result, invalidating only when the document
// actually changes (see the documentchange listener below).
var usedVariableIdsCache = null;
var documentChangeListenerRegistered = false;

// Analyze variable usage in the document
async function analyzeVariableUsage() {
    // Reuse the cached result when the document hasn't changed since last analysis.
    if (usedVariableIdsCache) {
        console.log('Reusing cached variable usage (' + usedVariableIdsCache.size + ' used)');
        return usedVariableIdsCache;
    }

    console.log('Analyzing variable usage...');

    var usedVariableIds = new Set();

    // Recursive function to traverse all nodes
    function traverseNode(node) {
        // Check variable bindings on the node
        if ('boundVariables' in node && node.boundVariables) {
            var boundVars = node.boundVariables;

            // Iterate through all bound properties
            var properties = Object.keys(boundVars);
            for (var i = 0; i < properties.length; i++) {
                var property = properties[i];
                var binding = boundVars[property];

                if (binding) {
                    if (Array.isArray(binding)) {
                        // For properties with multiple bindings (e.g., fills)
                        for (var j = 0; j < binding.length; j++) {
                            var b = binding[j];
                            if (b && b.id) {
                                usedVariableIds.add(b.id);
                            }
                        }
                    } else if (binding.id) {
                        // For properties with a single binding
                        usedVariableIds.add(binding.id);
                    }
                }
            }
        }

        // Traverse children if the node has any
        if ('children' in node) {
            var children = node.children;
            for (var k = 0; k < children.length; k++) {
                traverseNode(children[k]);
            }
        }
    }

    // IMPORTANT: Load all pages first
    // Note: loadAllPagesAsync may not be available in all versions
    if (figma.loadAllPagesAsync) {
        await figma.loadAllPagesAsync();
    }

    // Register the cache-invalidation listener once — in incremental (dynamic-page)
    // mode, documentchange can only be registered after loadAllPagesAsync.
    if (!documentChangeListenerRegistered) {
        documentChangeListenerRegistered = true;
        figma.on('documentchange', function() {
            usedVariableIdsCache = null;
            _localVarByIdCache = null;
        });
    }

    // Traverse all pages
    var pages = figma.root.children;
    for (var p = 0; p < pages.length; p++) {
        var page = pages[p];
        console.log('Analyzing page: ' + page.name);
        traverseNode(page);
    }

    console.log('Used variables found: ' + usedVariableIds.size);

    usedVariableIdsCache = usedVariableIds;
    return usedVariableIds;
}

// In-memory cache of local variables keyed by id, so alias resolution is a plain
// lookup instead of an async API round-trip per alias. Non-local (library)
// variables that aren't in the local set fall back to the async API.
var _localVarByIdCache = null;
async function getVariableByIdCached(id) {
    if (!_localVarByIdCache) {
        var locals = await figma.variables.getLocalVariablesAsync();
        _localVarByIdCache = {};
        for (var i = 0; i < locals.length; i++) {
            _localVarByIdCache[locals[i].id] = locals[i];
        }
    }
    if (_localVarByIdCache[id]) return _localVarByIdCache[id];
    return await figma.variables.getVariableByIdAsync(id);
}

// Resolve alias value recursively
async function resolveAliasValue(value, resolvedType) {
    // If not an alias, return the value directly
    if (!value || typeof value !== 'object' || value.type !== 'VARIABLE_ALIAS') {
        return value;
    }

    // Get the referenced variable (from the in-memory cache when possible)
    var referencedVar = await getVariableByIdCached(value.id);
    if (!referencedVar) {
        console.log('Alias variable not found:', value.id);
        return null;
    }

    // Get the value from the referenced variable
    var modeIds = Object.keys(referencedVar.valuesByMode);
    var modeId = modeIds[0];
    var resolvedValue = referencedVar.valuesByMode[modeId];

    // If still an alias, resolve recursively
    return await resolveAliasValue(resolvedValue, resolvedType);
}

// Extract all local variables
async function extractVariables(onlyUsed, selectedCollections) {
    console.log('Extracting variables...');

    var localVariables = await figma.variables.getLocalVariablesAsync();
    var collections = await figma.variables.getLocalVariableCollectionsAsync();

    console.log('Total variables: ' + localVariables.length);
    console.log('Collections found: ' + collections.length);

    // Build set of selected collection IDs for filtering
    var selectedCollectionIds = null;
    if (selectedCollections && selectedCollections.length > 0) {
        selectedCollectionIds = new Set(selectedCollections);
        console.log('Filtering by ' + selectedCollections.length + ' collections');
    }

    // If we only want used variables
    var usedVariableIds = new Set();
    if (onlyUsed) {
        usedVariableIds = await analyzeVariableUsage();
    }

    // Build a map of variable ID to normalized name for alias resolution
    // and to the original (slash-separated) name for DTCG references.
    var variableIdToName = {};
    var variableIdToOriginalName = {};
    for (var v = 0; v < localVariables.length; v++) {
        variableIdToName[localVariables[v].id] = normalizeVariableName(localVariables[v].name);
        variableIdToOriginalName[localVariables[v].id] = localVariables[v].name;
    }

    var variables = {
        colors: [],
        numbers: [],
        strings: [],
        booleans: []
    };

    var skippedCount = 0;

    for (var i = 0; i < localVariables.length; i++) {
        var variable = localVariables[i];

        // If filtering by collections and variable is not in selected collections, skip it
        if (selectedCollectionIds && !selectedCollectionIds.has(variable.variableCollectionId)) {
            skippedCount++;
            continue;
        }

        // If filtering by usage and variable is not used, skip it
        if (onlyUsed && !usedVariableIds.has(variable.id)) {
            skippedCount++;
            continue;
        }

        var collection = null;
        for (var c = 0; c < collections.length; c++) {
            if (collections[c].id === variable.variableCollectionId) {
                collection = collections[c];
                break;
            }
        }
        var collectionName = collection ? collection.name : 'Default';

        // Get the first value (default mode)
        var modeIds = Object.keys(variable.valuesByMode);
        var modeId = modeIds[0];
        var rawValue = variable.valuesByMode[modeId];

        // Check if this is an alias
        var isAlias = rawValue && typeof rawValue === 'object' && rawValue.type === 'VARIABLE_ALIAS';
        var referencedVarName = null;
        var referencedVarOriginalName = null;
        var value = rawValue;

        if (isAlias) {
            // Get the referenced variable name (normalized + original for DTCG references)
            referencedVarName = variableIdToName[rawValue.id];
            referencedVarOriginalName = variableIdToOriginalName[rawValue.id];
            // Resolve the alias to get the actual value for type checking
            value = await resolveAliasValue(rawValue, variable.resolvedType);
        }

        // If value could not be resolved, skip this variable
        if (value === null) {
            console.log('Variable skipped (unresolved alias):', variable.name);
            skippedCount++;
            continue;
        }

        var varData = {
            name: variable.name,
            normalizedName: normalizeVariableName(variable.name),
            collection: collectionName,
            value: value,
            type: variable.resolvedType,
            isUsed: usedVariableIds.has(variable.id),
            isAlias: isAlias,
            referencedVarName: referencedVarName,
            referencedVarOriginalName: referencedVarOriginalName,
            originalIndex: i
        };

        if (variable.resolvedType === 'COLOR') {
            if (typeof value === 'object' && 'r' in value) {
                varData.scssValue = rgbaToHex(value);
                variables.colors.push(varData);
            }
        } else if (variable.resolvedType === 'FLOAT') {
            varData.scssValue = (typeof value === 'number')
                ? formatNumberValue(classifyNumber(variable.name), value)
                : String(value);
            variables.numbers.push(varData);
        } else if (variable.resolvedType === 'STRING') {
            varData.scssValue = '"' + value + '"';
            variables.strings.push(varData);
        } else if (variable.resolvedType === 'BOOLEAN') {
            varData.scssValue = value ? 'true' : 'false';
            variables.booleans.push(varData);
        }
    }

    console.log('Variables extraites: colors=' + variables.colors.length + ' numbers=' + variables.numbers.length + ' strings=' + variables.strings.length + ' booleans=' + variables.booleans.length + ' skipped=' + skippedCount);

    // Text & effect styles are gated by the synthetic "Styles" collection: include
    // them only when it's selected (or when no collection filter is applied at all).
    var includeStyles = !selectedCollectionIds || selectedCollectionIds.has(STYLES_COLLECTION_ID);

    // Extract text styles
    var textStyles = includeStyles ? await extractTextStyles() : [];

    // Extract effect styles (shadows)
    var shadows = includeStyles ? await extractEffectStyles() : [];

    // Build mode data (themes / brands) for multi-mode collections
    var modes = buildModes(localVariables, collections, selectedCollectionIds, onlyUsed, usedVariableIds, variableIdToOriginalName);

    return {
        variables: variables,
        collections: collections,
        textStyles: textStyles,
        shadows: shadows,
        modeData: modes.modeData,
        modeTokenSets: modes.modeTokenSets,
        uniqueModeNames: modes.uniqueModeNames,
        totalVariables: localVariables.length,
        exportedVariables: localVariables.length - skippedCount,
        skippedVariables: skippedCount
    };
}

// Convert px to rem
function pxToRem(value) {
    return (value / 16).toFixed(value % 16 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'rem';
}

// Classify a numeric (FLOAT) variable into a semantic category based on its name.
// This drives both the chosen unit (rem / px / unitless) and the output grouping.
function classifyNumber(name) {
    var n = name.toLowerCase();

    // --- Unitless categories (must NOT get a px/rem suffix) ---
    if (n.indexOf('opacity') !== -1 || n.indexOf('alpha') !== -1) return 'opacity';
    if (n.indexOf('font-weight') !== -1 || n.indexOf('fontweight') !== -1 || n.indexOf('weight') !== -1) return 'font-weight';
    if (n.indexOf('z-index') !== -1 || n.indexOf('zindex') !== -1 || n.indexOf('z-order') !== -1) return 'z-index';
    if (n.indexOf('line-height') !== -1 || n.indexOf('lineheight') !== -1 || n.indexOf('leading') !== -1) return 'line-height';

    // --- Dimensional categories ---
    if (n.indexOf('breakpoint') !== -1 || n.indexOf('screen') !== -1) return 'breakpoints';
    if (n.indexOf('radius') !== -1 || n.indexOf('corner') !== -1 || n.indexOf('round') !== -1) return 'radius';
    if (n.indexOf('border-width') !== -1) return 'border-width';
    if ((n.indexOf('border') !== -1 || n.indexOf('stroke') !== -1) && n.indexOf('width') !== -1) return 'border-width';
    if (n.indexOf('sizing') !== -1 || n.indexOf('size') !== -1 || n.indexOf('width') !== -1 || n.indexOf('height') !== -1 || n.indexOf('icon') !== -1) return 'sizing';

    return 'spacing';
}

// Format a numeric value according to its semantic category.
// Fixes the previous bug where every FLOAT was suffixed with "px".
function formatNumberValue(category, value) {
    if (category === 'opacity') {
        return String(value); // 0..1, unitless
    }
    if (category === 'font-weight' || category === 'z-index') {
        return String(Math.round(value)); // unitless integer
    }
    if (category === 'line-height') {
        // Ratio (e.g. 1.5) stays unitless; an absolute value falls back to rem.
        return value <= 4 ? String(value) : pxToRem(value);
    }
    if (category === 'breakpoints') {
        return Math.round(value) + 'px'; // px required (media queries can't use rem reliably)
    }
    if (category === 'border-width') {
        return value + 'px'; // hairlines stay crisp in px
    }
    // spacing, sizing, radius
    return pxToRem(value);
}

// CSS custom-property prefixes per numeric category (shared by SCSS output and mode overrides).
var NUMBER_CSS_PREFIX = {
    'spacing': 'spacing',
    'sizing': 'size',
    'radius': 'radius',
    'border-width': 'border-width',
    'breakpoints': 'breakpoint',
    'opacity': 'opacity',
    'font-weight': 'font-weight',
    'line-height': 'line-height',
    'z-index': 'z-index'
};

// Normalize a collection/mode name for use in selectors and filenames.
function normalizeNamePart(name) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
}

// Build the CSS custom-property NAME for a variable (null if it isn't emitted in :root).
function cssVarNameFor(variable) {
    var normalized = normalizeVariableName(variable.name);
    if (variable.resolvedType === 'COLOR') {
        return '--color-' + removeTypePrefix(normalized, 'color');
    }
    if (variable.resolvedType === 'FLOAT') {
        var cat = classifyNumber(variable.name);
        if (cat === 'breakpoints') return null; // breakpoints are SCSS-only
        var prefix = NUMBER_CSS_PREFIX[cat];
        return '--' + prefix + '-' + removeTypePrefix(normalized, prefix);
    }
    return null; // strings/booleans are not emitted as themeable custom properties
}

// Compute the effective CSS value of a variable for a given raw mode value.
// Aliases become var(--ref) references (mode-stable); literals are formatted.
function effectiveCssValue(variable, raw, idToVar) {
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
        var refVar = idToVar[raw.id];
        if (!refVar) return null;
        var refName = cssVarNameFor(refVar);
        return refName ? 'var(' + refName + ')' : null;
    }
    if (variable.resolvedType === 'COLOR') {
        return (raw && typeof raw === 'object' && 'r' in raw) ? rgbaToHex(raw) : null;
    }
    if (variable.resolvedType === 'FLOAT') {
        if (typeof raw !== 'number' || isNaN(raw)) return null;
        var cat = classifyNumber(variable.name);
        if (cat === 'breakpoints') return null;
        return formatNumberValue(cat, raw);
    }
    return null;
}

// Build mode data for collections that have more than one mode:
//  - modeData      : CSS overrides per axis (collection) and mode, only what differs from default
//  - modeTokenSets : full DTCG variable arrays resolved per non-default mode name
//  - uniqueModeNames: distinct non-default mode names (drive the per-mode tokens.<mode>.json files)
function buildModes(localVariables, collections, selectedCollectionIds, onlyUsed, usedVariableIds, idToOriginalName) {
    var idToVar = {};
    for (var i = 0; i < localVariables.length; i++) idToVar[localVariables[i].id] = localVariables[i];
    var collById = {};
    for (var c = 0; c < collections.length; c++) collById[collections[c].id] = collections[c];

    function included(variable) {
        if (selectedCollectionIds && !selectedCollectionIds.has(variable.variableCollectionId)) return false;
        if (onlyUsed && !usedVariableIds.has(variable.id)) return false;
        return true;
    }

    var modeData = [];
    var modeTokenSets = {};
    var uniqueModeNames = [];
    var seenModeName = {};

    for (var ci = 0; ci < collections.length; ci++) {
        var collection = collections[ci];
        if (!collection.modes || collection.modes.length <= 1) continue;
        var defaultModeId = collection.defaultModeId;

        var collVars = [];
        for (var vi = 0; vi < localVariables.length; vi++) {
            var vv = localVariables[vi];
            if (vv.variableCollectionId !== collection.id) continue;
            if (!included(vv)) continue;
            collVars.push(vv);
        }
        if (collVars.length === 0) continue;

        var axis = {
            collectionName: collection.name,
            attribute: 'data-' + normalizeNamePart(collection.name),
            modes: []
        };

        for (var mi = 0; mi < collection.modes.length; mi++) {
            var mode = collection.modes[mi];
            if (mode.modeId === defaultModeId) continue;

            if (!seenModeName[mode.name]) {
                seenModeName[mode.name] = true;
                uniqueModeNames.push(mode.name);
            }

            var props = [];
            for (var k = 0; k < collVars.length; k++) {
                var variable = collVars[k];
                var cssVar = cssVarNameFor(variable);
                if (!cssVar) continue;
                var modeRaw = variable.valuesByMode[mode.modeId];
                if (modeRaw === undefined) continue;
                var defRaw = variable.valuesByMode[defaultModeId];
                var modeVal = effectiveCssValue(variable, modeRaw, idToVar);
                var defVal = effectiveCssValue(variable, defRaw, idToVar);
                if (modeVal !== null && modeVal !== defVal) {
                    props.push({ cssVar: cssVar, value: modeVal });
                }
            }

            axis.modes.push({
                modeName: mode.name,
                attrValue: normalizeNamePart(mode.name),
                props: props
            });
        }

        if (axis.modes.length > 0) modeData.push(axis);
    }

    // Full DTCG token sets per unique non-default mode name
    for (var u = 0; u < uniqueModeNames.length; u++) {
        var modeName = uniqueModeNames[u];
        var arrays = { colors: [], numbers: [], strings: [], booleans: [] };

        for (var vj = 0; vj < localVariables.length; vj++) {
            var v2 = localVariables[vj];
            if (!included(v2)) continue;
            var coll = collById[v2.variableCollectionId];
            if (!coll) continue;

            var chosenModeId = coll.defaultModeId;
            for (var mm = 0; mm < coll.modes.length; mm++) {
                if (coll.modes[mm].name === modeName && v2.valuesByMode[coll.modes[mm].modeId] !== undefined) {
                    chosenModeId = coll.modes[mm].modeId;
                    break;
                }
            }
            var raw2 = v2.valuesByMode[chosenModeId];
            if (raw2 === undefined) raw2 = v2.valuesByMode[coll.defaultModeId];

            var isAliasMode = raw2 && typeof raw2 === 'object' && raw2.type === 'VARIABLE_ALIAS';
            if (!isAliasMode && raw2 === undefined) continue;

            var item = {
                name: v2.name,
                value: isAliasMode ? null : raw2,
                isAlias: isAliasMode,
                referencedVarOriginalName: isAliasMode ? idToOriginalName[raw2.id] : null
            };

            if (v2.resolvedType === 'COLOR') arrays.colors.push(item);
            else if (v2.resolvedType === 'FLOAT') arrays.numbers.push(item);
            else if (v2.resolvedType === 'STRING') arrays.strings.push(item);
            else if (v2.resolvedType === 'BOOLEAN') arrays.booleans.push(item);
        }

        modeTokenSets[modeName] = arrays;
    }

    return { modeData: modeData, modeTokenSets: modeTokenSets, uniqueModeNames: uniqueModeNames };
}

// Generate content for both SCSS files
function generateScssFiles(data, options) {
    console.log('Generating SCSS files...');

    var variables = data.variables;
    var textStyles = data.textStyles || [];
    var shadows = data.shadows || [];

    // Separate primitives and aliases for each type
    var colorPrimitives = [];
    var colorAliases = [];
    var stringsPrimitives = [];
    var stringsAliases = [];

    // Number categories (data-driven). The order defines the output order.
    // cssPrefix: used both to strip the type prefix from names and to build CSS var names.
    // inRoot: whether the category is emitted as a CSS custom property (breakpoints are SCSS-only).
    var numberCategoryOrder = ['spacing', 'sizing', 'radius', 'border-width', 'breakpoints', 'opacity', 'font-weight', 'line-height', 'z-index'];
    var numberCategoryMeta = {
        'spacing':      { label: 'SPACING',       cssPrefix: 'spacing',      inRoot: true },
        'sizing':       { label: 'SIZING',        cssPrefix: 'size',         inRoot: true },
        'radius':       { label: 'BORDER RADIUS', cssPrefix: 'radius',       inRoot: true },
        'border-width': { label: 'BORDER WIDTH',  cssPrefix: 'border-width', inRoot: true },
        'breakpoints':  { label: 'BREAKPOINTS',   cssPrefix: 'breakpoint',   inRoot: false },
        'opacity':      { label: 'OPACITY',       cssPrefix: 'opacity',      inRoot: true },
        'font-weight':  { label: 'FONT WEIGHT',   cssPrefix: 'font-weight',  inRoot: true },
        'line-height':  { label: 'LINE HEIGHT',   cssPrefix: 'line-height',  inRoot: true },
        'z-index':      { label: 'Z-INDEX',       cssPrefix: 'z-index',      inRoot: true }
    };
    var numberGroups = {};
    for (var ncInit = 0; ncInit < numberCategoryOrder.length; ncInit++) {
        numberGroups[numberCategoryOrder[ncInit]] = { primitives: [], aliases: [] };
    }

    // Process colors
    for (var i = 0; i < variables.colors.length; i++) {
        var color = variables.colors[i];
        var colorData = {
            key: removeTypePrefix(color.normalizedName, 'color'),
            value: color.scssValue,
            originalName: color.name,
            referencedVarName: color.referencedVarName ? removeTypePrefix(color.referencedVarName, 'color') : null,
            originalIndex: color.originalIndex
        };
        if (color.isAlias) {
            colorAliases.push(colorData);
        } else {
            colorPrimitives.push(colorData);
        }
    }

    // Sort colors by original Figma order
    colorPrimitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    colorAliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });

    // Process numbers (spacing, sizing, radius, border-width, breakpoints, opacity, font-weight, line-height, z-index)
    for (var j = 0; j < variables.numbers.length; j++) {
        var num = variables.numbers[j];
        var numValue = num.value;

        // Check that value is a valid number
        if (typeof numValue !== 'number' || isNaN(numValue)) {
            console.log('Value skipped (non-numeric):', num.name, numValue);
            continue;
        }

        var category = classifyNumber(num.name);
        var meta = numberCategoryMeta[category];
        var numData = {
            key: removeTypePrefix(num.normalizedName, meta.cssPrefix),
            value: formatNumberValue(category, numValue),
            originalName: num.name,
            referencedVarName: num.referencedVarName ? removeTypePrefix(num.referencedVarName, meta.cssPrefix) : null,
            originalIndex: num.originalIndex
        };

        if (num.isAlias) {
            numberGroups[category].aliases.push(numData);
        } else {
            numberGroups[category].primitives.push(numData);
        }
    }

    // Sort each group by original Figma order instead of numeric value
    for (var sortIdx = 0; sortIdx < numberCategoryOrder.length; sortIdx++) {
        var sortGrp = numberGroups[numberCategoryOrder[sortIdx]];
        sortGrp.primitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
        sortGrp.aliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    }

    // Process strings
    for (var k = 0; k < variables.strings.length; k++) {
        var str = variables.strings[k];
        // For strings, we don't remove a prefix since they can be any type
        var strData = {
            key: str.normalizedName,
            value: str.scssValue,
            originalName: str.name,
            referencedVarName: str.referencedVarName,
            originalIndex: str.originalIndex
        };
        if (str.isAlias) {
            stringsAliases.push(strData);
        } else {
            stringsPrimitives.push(strData);
        }
    }

    // Sort strings by original Figma order
    stringsPrimitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    stringsAliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });

    // Process booleans (SCSS-only: a CSS custom property for a boolean is meaningless)
    var booleanVars = [];
    for (var bIdx = 0; bIdx < variables.booleans.length; bIdx++) {
        var bool = variables.booleans[bIdx];
        booleanVars.push({
            key: bool.normalizedName,
            value: bool.scssValue,
            originalIndex: bool.originalIndex
        });
    }
    booleanVars.sort(function(a, b) { return a.originalIndex - b.originalIndex; });

    // ========================================
    // Generate _variables.scss (PRIMITIVES ONLY)
    // ========================================
    var variablesScss = '';

    // Header
    variablesScss += '// ==========================================\n';
    variablesScss += '// Figma Variables - Auto-generated with Variables to WordPress\n';
    variablesScss += '// Date: ' + new Date().toLocaleString('en-US') + '\n';
    variablesScss += '// ==========================================\n\n';

    // Font families from text styles - extract first to filter duplicates
    var familyMap = {};
    var familyKeys = new Set();
    if (textStyles.length > 0) {
        // Build a map of unique font families by folder
        for (var ts = 0; ts < textStyles.length; ts++) {
            var textStyle = textStyles[ts];
            var folder = textStyle.normalizedFolder || 'default';
            if (!familyMap[folder]) {
                familyMap[folder] = textStyle.fontFamily;
                familyKeys.add('family-' + folder);
            }
        }
    }

    // Filter out string primitives and aliases that are font families
    var filteredStringsPrimitives = [];
    for (var fsp = 0; fsp < stringsPrimitives.length; fsp++) {
        if (!familyKeys.has(stringsPrimitives[fsp].key)) {
            filteredStringsPrimitives.push(stringsPrimitives[fsp]);
        }
    }

    var filteredStringsAliases = [];
    for (var fsa = 0; fsa < stringsAliases.length; fsa++) {
        if (!familyKeys.has(stringsAliases[fsa].key)) {
            filteredStringsAliases.push(stringsAliases[fsa]);
        }
    }

    // Variables simples (strings) - primitives only (excluding font families)
    if (filteredStringsPrimitives.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// SIMPLE VARIABLES\n';
        variablesScss += '// ====================================\n\n';
        for (var s = 0; s < filteredStringsPrimitives.length; s++) {
            variablesScss += '$' + filteredStringsPrimitives[s].key + ': ' + filteredStringsPrimitives[s].value + ';\n';
        }
        variablesScss += '\n';
    }

    // Font families from text styles
    if (textStyles.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// FONT FAMILIES\n';
        variablesScss += '// ====================================\n\n';

        var folders = Object.keys(familyMap);
        for (var f = 0; f < folders.length; f++) {
            var folderKey = folders[f];
            variablesScss += '$family-' + folderKey + ': "' + familyMap[folderKey] + '";\n';
        }
        variablesScss += '\n';
    }

    // Colors map - primitives only
    if (colorPrimitives.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// COLORS\n';
        variablesScss += '// ====================================\n\n';
        variablesScss += '$colors: (\n';
        for (var c = 0; c < colorPrimitives.length; c++) {
            variablesScss += '        ' + colorPrimitives[c].key + ': ' + colorPrimitives[c].value;
            variablesScss += (c < colorPrimitives.length - 1) ? ',\n' : '\n';
        }
        variablesScss += ');\n\n';
    }

    // Number maps - primitives only (data-driven: spacing, sizing, radius, border-width, breakpoints, opacity...)
    for (var mapIdx = 0; mapIdx < numberCategoryOrder.length; mapIdx++) {
        var mapCat = numberCategoryOrder[mapIdx];
        var mapPrims = numberGroups[mapCat].primitives;
        if (mapPrims.length === 0) continue;

        variablesScss += '// ====================================\n';
        variablesScss += '// ' + numberCategoryMeta[mapCat].label + '\n';
        variablesScss += '// ====================================\n\n';
        variablesScss += '$' + mapCat + ': (\n';
        for (var mp = 0; mp < mapPrims.length; mp++) {
            variablesScss += '        ' + mapPrims[mp].key + ': ' + mapPrims[mp].value;
            variablesScss += (mp < mapPrims.length - 1) ? ',\n' : '\n';
        }
        variablesScss += ');\n\n';
    }

    // Booleans - simple SCSS variables
    if (booleanVars.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// BOOLEANS\n';
        variablesScss += '// ====================================\n\n';
        for (var bv = 0; bv < booleanVars.length; bv++) {
            variablesScss += '$' + booleanVars[bv].key + ': ' + booleanVars[bv].value + ';\n';
        }
        variablesScss += '\n';
    }

    // Shadows - simple SCSS variables (comma-separated box-shadow lists)
    if (shadows.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// SHADOWS\n';
        variablesScss += '// ====================================\n\n';
        for (var shv = 0; shv < shadows.length; shv++) {
            variablesScss += '$shadow-' + shadows[shv].name + ': ' + shadows[shv].value + ';\n';
        }
        variablesScss += '\n';
    }

    // ========================================
    // Generate _root.scss (CSS Custom Properties)
    // ========================================
    var rootScss = '@import "variables";\n\n';
    rootScss += ':root, body {\n';

    // Primitives section
    rootScss += '  // ====================================\n';
    rootScss += '  // PRIMITIVES\n';
    rootScss += '  // ====================================\n\n';

    // Colors - primitives
    if (colorPrimitives.length > 0) {
        rootScss += '  // COLORS\n';
        rootScss += '  @each $key, $val in $colors {\n';
        rootScss += '    --color-#{$key}: #{$val};\n';
        rootScss += '  }\n\n';
    }

    // Number primitives - data-driven (breakpoints are skipped: CSS vars can't be used in media queries)
    for (var rootIdx = 0; rootIdx < numberCategoryOrder.length; rootIdx++) {
        var rootCat = numberCategoryOrder[rootIdx];
        var rootMeta = numberCategoryMeta[rootCat];
        if (!rootMeta.inRoot) continue;
        if (numberGroups[rootCat].primitives.length === 0) continue;

        rootScss += '  // ' + rootMeta.label + '\n';
        rootScss += '  @each $key, $val in $' + rootCat + ' {\n';
        rootScss += '    --' + rootMeta.cssPrefix + '-#{$key}: #{$val};\n';
        rootScss += '  }\n\n';
    }

    // Text styles
    if (textStyles.length > 0) {
        rootScss += '  // FONT STYLES\n';
        for (var tsi = 0; tsi < textStyles.length; tsi++) {
            var style = textStyles[tsi];
            var fontSizeRem = pxToRem(style.fontSize);
            var folder = style.normalizedFolder || 'default';
            rootScss += '  --font-' + style.normalizedName + ': ' + style.fontWeightValue + ' ' + fontSizeRem + ' #{$family-' + folder + '};\n';
        }
        rootScss += '\n';
    }

    // Shadows
    if (shadows.length > 0) {
        rootScss += '  // SHADOWS\n';
        for (var shr = 0; shr < shadows.length; shr++) {
            rootScss += '  --shadow-' + shadows[shr].name + ': ' + shadows[shr].value + ';\n';
        }
        rootScss += '\n';
    }

    // Aliases section (semantic tokens)
    var hasNumberAliases = false;
    for (var hnaIdx = 0; hnaIdx < numberCategoryOrder.length; hnaIdx++) {
        var hnaCat = numberCategoryOrder[hnaIdx];
        if (numberCategoryMeta[hnaCat].inRoot && numberGroups[hnaCat].aliases.length > 0) {
            hasNumberAliases = true;
            break;
        }
    }
    var hasAliases = colorAliases.length > 0 || hasNumberAliases || filteredStringsAliases.length > 0;

    if (hasAliases) {
        rootScss += '  // ====================================\n';
        rootScss += '  // ALIASES (Semantic tokens)\n';
        rootScss += '  // ====================================\n\n';

        // Color aliases
        if (colorAliases.length > 0) {
            rootScss += '  // COLORS\n';
            for (var ca = 0; ca < colorAliases.length; ca++) {
                var alias = colorAliases[ca];
                rootScss += '  --color-' + alias.key + ': var(--color-' + alias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }

        // Number aliases - data-driven
        for (var aliasIdx = 0; aliasIdx < numberCategoryOrder.length; aliasIdx++) {
            var aliasCat = numberCategoryOrder[aliasIdx];
            var aliasMeta = numberCategoryMeta[aliasCat];
            if (!aliasMeta.inRoot) continue;
            var aliasArr = numberGroups[aliasCat].aliases;
            if (aliasArr.length === 0) continue;

            rootScss += '  // ' + aliasMeta.label + '\n';
            for (var na = 0; na < aliasArr.length; na++) {
                rootScss += '  --' + aliasMeta.cssPrefix + '-' + aliasArr[na].key + ': var(--' + aliasMeta.cssPrefix + '-' + aliasArr[na].referencedVarName + ');\n';
            }
            rootScss += '\n';
        }

        // String aliases (excluding font families)
        if (filteredStringsAliases.length > 0) {
            rootScss += '  // STRINGS\n';
            for (var ssa = 0; ssa < filteredStringsAliases.length; ssa++) {
                var salias = filteredStringsAliases[ssa];
                rootScss += '  --' + salias.key + ': var(--' + salias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }
    }

    rootScss += '}\n';

    // Mode overrides (themes, brands...) as scoped attribute selectors.
    // Base values live in :root; each non-default mode overrides only what differs.
    var modeData = data.modeData || [];
    for (var md = 0; md < modeData.length; md++) {
        var axis = modeData[md];
        for (var mo = 0; mo < axis.modes.length; mo++) {
            var modeBlock = axis.modes[mo];
            if (!modeBlock.props || modeBlock.props.length === 0) continue;
            rootScss += '\n// ' + axis.collectionName + ' — ' + modeBlock.modeName + '\n';
            rootScss += '[' + axis.attribute + '="' + modeBlock.attrValue + '"] {\n';
            for (var pp = 0; pp < modeBlock.props.length; pp++) {
                rootScss += '  ' + modeBlock.props[pp].cssVar + ': ' + modeBlock.props[pp].value + ';\n';
            }
            rootScss += '}\n';
        }
    }

    console.log('_variables.scss generated: ' + variablesScss.length + ' characters');
    console.log('_root.scss generated: ' + rootScss.length + ' characters');

    // Combine all for backward compatibility (using filtered strings)
    var allColorMap = colorPrimitives.concat(colorAliases);
    var allSpacingMap = numberGroups['spacing'].primitives.concat(numberGroups['spacing'].aliases);
    var allRadiusMap = numberGroups['radius'].primitives.concat(numberGroups['radius'].aliases);
    var allStringsVars = filteredStringsPrimitives.concat(filteredStringsAliases);

    return {
        variables: variablesScss,
        root: rootScss,
        colorMap: allColorMap,
        spacingMap: allSpacingMap,
        radiusMap: allRadiusMap,
        stringsVars: allStringsVars
    };
}

// Generate WordPress theme.json content
function generateThemeJson(scssData) {
    console.log('Generating theme.json...');

    var colorMap = scssData.colorMap;
    var spacingMap = scssData.spacingMap;
    var radiusMap = scssData.radiusMap;
    var stringsVars = scssData.stringsVars;

    // Build color palette
    var colorPalette = [];
    for (var i = 0; i < colorMap.length; i++) {
        var color = colorMap[i];
        colorPalette.push({
            slug: color.key,
            color: color.value,
            name: color.key.charAt(0).toUpperCase() + color.key.slice(1).replace(/-/g, ' ')
        });
    }

    // Build font families from string variables
    var fontFamilies = [];
    for (var f = 0; f < stringsVars.length; f++) {
        var strVar = stringsVars[f];
        var lowerKey = strVar.key.toLowerCase();
        if (lowerKey.indexOf('font') !== -1 || lowerKey.indexOf('family') !== -1 || lowerKey.indexOf('typeface') !== -1) {
            var fontValue = strVar.value.replace(/^["']|["']$/g, '');
            fontFamilies.push({
                fontFamily: fontValue,
                slug: strVar.key,
                name: strVar.key.charAt(0).toUpperCase() + strVar.key.slice(1).replace(/-/g, ' ')
            });
        }
    }

    // Build spacing sizes
    var spacingSizes = [];
    for (var j = 0; j < spacingMap.length; j++) {
        var spacing = spacingMap[j];
        spacingSizes.push({
            slug: String(spacing.key),
            size: spacing.value,
            name: spacing.key + 'px'
        });
    }

    // Build custom spacing object
    var customSpacing = {};
    for (var k = 0; k < spacingMap.length; k++) {
        customSpacing[spacingMap[k].key] = spacingMap[k].value;
    }

    // Build custom radius object
    var customRadius = {};
    for (var r = 0; r < radiusMap.length; r++) {
        customRadius[radiusMap[r].key] = radiusMap[r].value;
    }

    // Build theme.json structure
    var themeJson = {
        "$schema": "https://schemas.wp.org/trunk/theme.json",
        "version": 2,
        "settings": {
            "color": {
                "palette": colorPalette
            },
            "spacing": {
                "spacingSizes": spacingSizes
            },
            "custom": {
                "spacing": customSpacing,
                "radius": customRadius
            }
        }
    };

    // Add typography if font families were found
    if (fontFamilies.length > 0) {
        themeJson.settings.typography = {
            fontFamilies: fontFamilies
        };
    }

    var jsonString = JSON.stringify(themeJson, null, 2);
    console.log('theme.json generated: ' + jsonString.length + ' characters');

    return jsonString;
}

// Split a Figma variable name into DTCG path segments.
// DTCG forbids '.', '{', '}' and '$' in names; '/' is the Figma group separator.
function dtcgPathSegments(figmaName) {
    return figmaName.split('/').map(function(seg) {
        return seg.trim().replace(/\./g, ' ').replace(/[{}$]/g, '');
    });
}

// Place a token object at the right nested path in the tree.
function setTokenAtPath(root, segments, token) {
    var node = root;
    for (var i = 0; i < segments.length - 1; i++) {
        var seg = segments[i];
        if (!node[seg] || typeof node[seg] !== 'object' || node[seg].$value !== undefined) {
            node[seg] = {};
        }
        node = node[seg];
    }
    node[segments[segments.length - 1]] = token;
}

// Convert a Figma lineHeight ({value, unit}) to a DTCG value.
// AUTO -> omitted; PERCENT -> unitless ratio; PIXELS -> px dimension.
function dtcgLineHeight(lh) {
    if (!lh || typeof lh !== 'object') return null;
    if (lh.unit === 'AUTO') return null;
    if (lh.unit === 'PERCENT') return Math.round((lh.value / 100) * 1000) / 1000;
    return lh.value + 'px';
}

// Convert a Figma letterSpacing ({value, unit}) to a DTCG dimension (px).
// PERCENT is resolved against the font size so the output stays in px.
function dtcgLetterSpacing(ls, fontSize) {
    if (!ls || typeof ls !== 'object') return null;
    if (ls.value === 0) return '0px';
    if (ls.unit === 'PERCENT') return Math.round((ls.value / 100) * fontSize * 1000) / 1000 + 'px';
    return ls.value + 'px';
}

// Generate a W3C Design Tokens (DTCG) tokens.json from the extracted variables.
// Aliases are preserved as references (e.g. "{color.green.500}") rather than resolved,
// so the file stays a true source format. Values keep their raw Figma units (px).
function generateDtcgTokens(data) {
    var variables = data.variables;
    var root = {};

    function addToken(figmaName, type, value, isAlias, refOriginalName) {
        var token = {};
        if (type) token['$type'] = type;
        if (isAlias && refOriginalName) {
            token['$value'] = '{' + dtcgPathSegments(refOriginalName).join('.') + '}';
        } else {
            token['$value'] = value;
        }
        setTokenAtPath(root, dtcgPathSegments(figmaName), token);
    }

    // Colors
    for (var i = 0; i < variables.colors.length; i++) {
        var c = variables.colors[i];
        var hex = (c.value && typeof c.value === 'object' && 'r' in c.value) ? rgbaToHex(c.value) : c.value;
        addToken(c.name, 'color', hex, c.isAlias, c.referencedVarOriginalName);
    }

    // Numbers
    for (var j = 0; j < variables.numbers.length; j++) {
        var num = variables.numbers[j];
        var isRef = num.isAlias && num.referencedVarOriginalName;
        // Literals need a valid number; references carry no value (emitted as "{...}").
        if (!isRef && (typeof num.value !== 'number' || isNaN(num.value))) continue;
        var cat = classifyNumber(num.name);
        var type, val;
        if (cat === 'opacity' || cat === 'line-height' || cat === 'z-index') {
            type = 'number';
            val = isRef ? null : num.value;
        } else if (cat === 'font-weight') {
            type = 'fontWeight';
            val = isRef ? null : Math.round(num.value);
        } else {
            type = 'dimension';
            val = isRef ? null : (num.value + 'px'); // raw px source value; consumers convert to rem if needed
        }
        addToken(num.name, type, val, num.isAlias, num.referencedVarOriginalName);
    }

    // Strings (font families get the proper DTCG type; others stay typeless)
    for (var k = 0; k < variables.strings.length; k++) {
        var s = variables.strings[k];
        var lower = s.name.toLowerCase();
        var isFont = lower.indexOf('font') !== -1 || lower.indexOf('family') !== -1 || lower.indexOf('typeface') !== -1;
        addToken(s.name, isFont ? 'fontFamily' : null, s.value, s.isAlias, s.referencedVarOriginalName);
    }

    // Booleans (no standard DTCG type; emitted as raw boolean values)
    for (var b = 0; b < variables.booleans.length; b++) {
        var bo = variables.booleans[b];
        addToken(bo.name, null, bo.value, bo.isAlias, bo.referencedVarOriginalName);
    }

    // Typography (text styles -> DTCG typography composite)
    var textStyles = data.textStyles || [];
    for (var t = 0; t < textStyles.length; t++) {
        var ts = textStyles[t];
        var typographyValue = {
            fontFamily: ts.fontFamily,
            fontSize: ts.fontSize + 'px',
            fontWeight: parseInt(ts.fontWeightValue, 10)
        };
        var lh = dtcgLineHeight(ts.lineHeight);
        if (lh !== null) typographyValue.lineHeight = lh;
        var ls = dtcgLetterSpacing(ts.letterSpacing, ts.fontSize);
        if (ls !== null) typographyValue.letterSpacing = ls;

        setTokenAtPath(root, dtcgPathSegments(ts.name), { '$type': 'typography', '$value': typographyValue });
    }

    // Shadows (effect styles -> DTCG shadow composite)
    var shadows = data.shadows || [];
    for (var sh = 0; sh < shadows.length; sh++) {
        var shadow = shadows[sh];
        if (!shadow.layers || shadow.layers.length === 0) continue;
        var shadowValue = shadow.layers.length === 1 ? shadow.layers[0] : shadow.layers;
        setTokenAtPath(root, dtcgPathSegments(shadow.originalName || shadow.name), { '$type': 'shadow', '$value': shadowValue });
    }

    var jsonString = JSON.stringify(root, null, 2);
    console.log('tokens.json (DTCG) generated: ' + jsonString.length + ' characters');
    return jsonString;
}

// Listen to messages from UI
figma.ui.onmessage = async function(msg) {
    console.log('Message received:', msg);

    if (msg.type === 'cancel') {
        console.log('Closing plugin');
        figma.closePlugin();
        return;
    }

    if (msg.type === 'notify') {
        // Native Figma toast (shown at the bottom of the canvas)
        figma.notify(msg.message || '');
        return;
    }

    if (msg.type === 'generate') {
        try {
            console.log('Starting generation');
            figma.notify('🔄 Extracting variables...', { timeout: 2000 });

            var data = await extractVariables(msg.options.onlyUsed, msg.options.selectedCollections);

            // Determine requested output formats (default: SCSS, for backward compatibility)
            var formats = msg.options.formats || { scss: true, dtcg: false };

            console.log('Sending files to UI');

            // Build files array based on selected formats
            var files = [];

            if (formats.scss) {
                var scssFiles = generateScssFiles(data, msg.options);
                files.push({ filename: '_variables.scss', content: scssFiles.variables });
                files.push({ filename: '_root.scss', content: scssFiles.root });
            }

            if (formats.dtcg) {
                files.push({ filename: 'tokens.json', content: generateDtcgTokens(data) });
            }

            if (files.length === 0) {
                figma.notify('⚠️ Select at least one output format', { error: true });
                return;
            }

            // Send files to UI for download
            figma.ui.postMessage({
                type: 'download-multiple',
                files: files,
                stats: {
                    total: data.totalVariables,
                    exported: data.exportedVariables,
                    skipped: data.skippedVariables,
                    collections: data.collections.length,
                    colors: data.variables.colors.length,
                    numbers: data.variables.numbers.length,
                    strings: data.variables.strings.length,
                    booleans: data.variables.booleans.length
                }
            });

            var notificationMsg = '✅ Files generated!';
            if (data.skippedVariables > 0) {
                notificationMsg += ' (' + data.skippedVariables + ' variables skipped)';
            }

            figma.notify(notificationMsg, { timeout: 4000 });

            // Stats
            var stats = 'Exported variables:\n' +
                '- Colors: ' + data.variables.colors.length + '\n' +
                '- Numbers: ' + data.variables.numbers.length + '\n' +
                '- Strings: ' + data.variables.strings.length + '\n' +
                '- Collections: ' + data.collections.length + '\n' +
                '- Total: ' + data.exportedVariables + '/' + data.totalVariables;

            console.log(stats);

        } catch (error) {
            console.error('Error:', error);
            figma.notify('❌ Error: ' + error.message, { error: true });
        }
    }

    if (msg.type === 'preview') {
        // Build the full set of export files (both SCSS and DTCG) and send them to
        // the UI so it can list them, copy their contents, and download each one
        // independently — without triggering any download here.
        try {
            var previewData = await extractVariables(msg.options.onlyUsed, msg.options.selectedCollections);

            var previewFiles = [];
            var previewScss = generateScssFiles(previewData, msg.options);
            previewFiles.push({ filename: '_variables.scss', content: previewScss.variables });
            previewFiles.push({ filename: '_root.scss', content: previewScss.root });
            previewFiles.push({ filename: 'tokens.json', content: generateDtcgTokens(previewData) });

            figma.ui.postMessage({
                type: 'preview-files',
                files: previewFiles,
                stats: {
                    total: previewData.totalVariables,
                    exported: previewData.exportedVariables,
                    skipped: previewData.skippedVariables,
                    collections: previewData.collections.length,
                    colors: previewData.variables.colors.length,
                    numbers: previewData.variables.numbers.length,
                    strings: previewData.variables.strings.length,
                    booleans: previewData.variables.booleans.length
                }
            });
        } catch (error) {
            console.error('Error building preview:', error);
            figma.notify('❌ Error: ' + error.message, { error: true });
        }
    }

    if (msg.type === 'generate-theme') {
        try {
            console.log('Starting theme.json generation with mappings');
            figma.notify('🔄 Generating theme.json...', { timeout: 2000 });

            var mappings = msg.mappings;
            var onlyUsed = msg.onlyUsed;
            var localVariables = await figma.variables.getLocalVariablesAsync();

            // Get used variables if filtering is enabled
            var usedVariableIds = new Set();
            if (onlyUsed) {
                usedVariableIds = await analyzeVariableUsage();
            }

            // Helper function to check if variable belongs to a group
            // groupId format: "collectionId/groupName"
            function variableMatchesGroup(variable, groupId) {
                if (!groupId) return false;
                var slashIndex = groupId.indexOf('/');
                if (slashIndex === -1) {
                    // Old format: just collection ID (backward compatibility)
                    return variable.variableCollectionId === groupId;
                }
                var collectionId = groupId.substring(0, slashIndex);
                var groupName = groupId.substring(slashIndex + 1);

                // Check collection matches
                if (variable.variableCollectionId !== collectionId) return false;

                // Check group name matches (first segment of variable name)
                var varGroupName = variable.name.split('/')[0].trim();
                return varGroupName === groupName;
            }

            // Helper function to check if variable should be included
            function shouldIncludeVariable(variable) {
                if (!onlyUsed) return true;
                return usedVariableIds.has(variable.id);
            }

            // Build theme.json structure
            var themeJson = {
                "$schema": "https://schemas.wp.org/trunk/theme.json",
                "version": 2,
                "settings": {}
            };

            // Process colors
            if (mappings.colors) {
                var colorPalette = [];
                for (var i = 0; i < localVariables.length; i++) {
                    var variable = localVariables[i];
                    if (variableMatchesGroup(variable, mappings.colors) && variable.resolvedType === 'COLOR' && shouldIncludeVariable(variable)) {
                        var modeIds = Object.keys(variable.valuesByMode);
                        var value = await resolveAliasValue(variable.valuesByMode[modeIds[0]], 'COLOR');
                        if (value && typeof value === 'object' && 'r' in value) {
                            var name = removeTypePrefix(normalizeVariableName(variable.name), 'color');
                            colorPalette.push({
                                slug: name,
                                color: rgbaToHex(value),
                                name: name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')
                            });
                        }
                    }
                }
                if (colorPalette.length > 0) {
                    themeJson.settings.color = { palette: colorPalette };
                }
            }

            // Process font families
            if (mappings.fontFamilies) {
                var fontFamilies = [];
                for (var j = 0; j < localVariables.length; j++) {
                    var variable = localVariables[j];
                    if (variableMatchesGroup(variable, mappings.fontFamilies) && variable.resolvedType === 'STRING' && shouldIncludeVariable(variable)) {
                        var modeIds = Object.keys(variable.valuesByMode);
                        var value = await resolveAliasValue(variable.valuesByMode[modeIds[0]], 'STRING');
                        if (value) {
                            var name = removeTypePrefix(normalizeVariableName(variable.name), 'font');
                            fontFamilies.push({
                                fontFamily: value,
                                slug: name,
                                name: name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')
                            });
                        }
                    }
                }
                if (fontFamilies.length > 0) {
                    if (!themeJson.settings.typography) themeJson.settings.typography = {};
                    themeJson.settings.typography.fontFamilies = fontFamilies;
                }
            }

            // Process font sizes
            if (mappings.fontSizes) {
                var fontSizes = [];
                for (var k = 0; k < localVariables.length; k++) {
                    var variable = localVariables[k];
                    if (variableMatchesGroup(variable, mappings.fontSizes) && variable.resolvedType === 'FLOAT' && shouldIncludeVariable(variable)) {
                        var modeIds = Object.keys(variable.valuesByMode);
                        var value = await resolveAliasValue(variable.valuesByMode[modeIds[0]], 'FLOAT');
                        if (typeof value === 'number' && !isNaN(value)) {
                            var name = removeTypePrefix(normalizeVariableName(variable.name), 'size');
                            fontSizes.push({
                                slug: name,
                                size: pxToRem(value),
                                name: name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')
                            });
                        }
                    }
                }
                if (fontSizes.length > 0) {
                    if (!themeJson.settings.typography) themeJson.settings.typography = {};
                    themeJson.settings.typography.fontSizes = fontSizes;
                }
            }

            // Process spacing
            if (mappings.spacing) {
                var spacingSizes = [];
                for (var l = 0; l < localVariables.length; l++) {
                    var variable = localVariables[l];
                    if (variableMatchesGroup(variable, mappings.spacing) && variable.resolvedType === 'FLOAT' && shouldIncludeVariable(variable)) {
                        var modeIds = Object.keys(variable.valuesByMode);
                        var value = await resolveAliasValue(variable.valuesByMode[modeIds[0]], 'FLOAT');
                        if (typeof value === 'number' && !isNaN(value)) {
                            var name = removeTypePrefix(normalizeVariableName(variable.name), 'spacing');
                            spacingSizes.push({
                                slug: name,
                                size: pxToRem(value),
                                name: Math.round(value) + 'px'
                            });
                        }
                    }
                }
                if (spacingSizes.length > 0) {
                    themeJson.settings.spacing = { spacingSizes: spacingSizes };
                }
            }

            // Process radius
            if (mappings.radius) {
                var customRadius = {};
                for (var m = 0; m < localVariables.length; m++) {
                    var variable = localVariables[m];
                    if (variableMatchesGroup(variable, mappings.radius) && variable.resolvedType === 'FLOAT' && shouldIncludeVariable(variable)) {
                        var modeIds = Object.keys(variable.valuesByMode);
                        var value = await resolveAliasValue(variable.valuesByMode[modeIds[0]], 'FLOAT');
                        if (typeof value === 'number' && !isNaN(value)) {
                            var name = removeTypePrefix(normalizeVariableName(variable.name), 'radius');
                            customRadius[name] = pxToRem(value);
                        }
                    }
                }
                if (Object.keys(customRadius).length > 0) {
                    if (!themeJson.settings.custom) themeJson.settings.custom = {};
                    themeJson.settings.custom.radius = customRadius;
                }
            }

            var themeJsonContent = JSON.stringify(themeJson, null, 2);
            console.log('theme.json generated: ' + themeJsonContent.length + ' characters');

            figma.ui.postMessage({
                type: 'download-theme',
                content: themeJsonContent
            });

            figma.notify('✅ theme.json generated!', { timeout: 4000 });

        } catch (error) {
            console.error('Error:', error);
            figma.notify('❌ Error: ' + error.message, { error: true });
        }
    }
};