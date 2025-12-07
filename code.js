// code.js - Figma plugin with variable usage detection

console.log('Plugin started');

figma.showUI(__html__, { width: 460, height: 650 });

// Send initial stats when plugin loads
async function sendInitialStats() {
    try {
        var localVariables = await figma.variables.getLocalVariablesAsync();
        var collections = await figma.variables.getLocalVariableCollectionsAsync();

        // Analyze usage
        var usedVariableIds = await analyzeVariableUsage();

        var colors = 0;
        var numbers = 0;
        var strings = 0;
        var booleans = 0;
        var usedCount = 0;

        for (var i = 0; i < localVariables.length; i++) {
            var variable = localVariables[i];
            if (variable.resolvedType === 'COLOR') colors++;
            else if (variable.resolvedType === 'FLOAT') numbers++;
            else if (variable.resolvedType === 'STRING') strings++;
            else if (variable.resolvedType === 'BOOLEAN') booleans++;

            if (usedVariableIds.has(variable.id)) {
                usedCount++;
            }
        }

        var skippedCount = localVariables.length - usedCount;

        // Build collections array with id and name
        var collectionsArray = [];
        for (var c = 0; c < collections.length; c++) {
            collectionsArray.push({
                id: collections[c].id,
                name: collections[c].name
            });
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

        figma.ui.postMessage({
            type: 'initial-stats',
            stats: {
                total: localVariables.length,
                exported: usedCount,
                skipped: skippedCount,
                collections: collections.length,
                colors: colors,
                numbers: numbers,
                strings: strings,
                booleans: booleans
            },
            collections: collectionsArray,
            variableGroups: variableGroups
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

// Analyze variable usage in the document
async function analyzeVariableUsage() {
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

    // Traverse all pages
    var pages = figma.root.children;
    for (var p = 0; p < pages.length; p++) {
        var page = pages[p];
        console.log('Analyzing page: ' + page.name);
        traverseNode(page);
    }

    console.log('Used variables found: ' + usedVariableIds.size);

    return usedVariableIds;
}

// Resolve alias value recursively
async function resolveAliasValue(value, resolvedType) {
    // If not an alias, return the value directly
    if (!value || typeof value !== 'object' || value.type !== 'VARIABLE_ALIAS') {
        return value;
    }

    // Get the referenced variable
    var referencedVar = await figma.variables.getVariableByIdAsync(value.id);
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
    var variableIdToName = {};
    for (var v = 0; v < localVariables.length; v++) {
        variableIdToName[localVariables[v].id] = normalizeVariableName(localVariables[v].name);
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
        var value = rawValue;

        if (isAlias) {
            // Get the referenced variable name
            referencedVarName = variableIdToName[rawValue.id];
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
            originalIndex: i
        };

        if (variable.resolvedType === 'COLOR') {
            if (typeof value === 'object' && 'r' in value) {
                varData.scssValue = rgbaToHex(value);
                variables.colors.push(varData);
            }
        } else if (variable.resolvedType === 'FLOAT') {
            varData.scssValue = value + 'px';
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

    // Extract text styles
    var textStyles = await extractTextStyles();

    return {
        variables: variables,
        collections: collections,
        textStyles: textStyles,
        totalVariables: localVariables.length,
        exportedVariables: localVariables.length - skippedCount,
        skippedVariables: skippedCount
    };
}

// Convert px to rem
function pxToRem(value) {
    return (value / 16).toFixed(value % 16 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'rem';
}

// Determine numeric variable type (spacing, radius, etc.)
function getNumberType(name) {
    var lowerName = name.toLowerCase();
    if (lowerName.indexOf('radius') !== -1 || lowerName.indexOf('corner') !== -1 || lowerName.indexOf('round') !== -1) {
        return 'radius';
    }
    if (lowerName.indexOf('breakpoint') !== -1 || lowerName.indexOf('screen') !== -1) {
        return 'breakpoints';
    }
    return 'spacing';
}

// Generate content for both SCSS files
function generateScssFiles(data, options) {
    console.log('Generating SCSS files...');

    var variables = data.variables;
    var textStyles = data.textStyles || [];

    // Separate primitives and aliases for each type
    var colorPrimitives = [];
    var colorAliases = [];
    var spacingPrimitives = [];
    var spacingAliases = [];
    var radiusPrimitives = [];
    var radiusAliases = [];
    var breakpointsPrimitives = [];
    var breakpointsAliases = [];
    var stringsPrimitives = [];
    var stringsAliases = [];

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

    // Process numbers (spacing, radius, breakpoints)
    for (var j = 0; j < variables.numbers.length; j++) {
        var num = variables.numbers[j];
        var numType = getNumberType(num.name);
        var numValue = num.value;

        // Check that value is a valid number
        if (typeof numValue !== 'number' || isNaN(numValue)) {
            console.log('Value skipped (non-numeric):', num.name, numValue);
            continue;
        }

        var typePrefix = numType === 'breakpoints' ? 'breakpoint' : (numType === 'radius' ? 'radius' : 'spacing');
        var numData = {
            key: removeTypePrefix(num.normalizedName, typePrefix),
            numKey: Math.round(numValue),
            value: numType === 'breakpoints' ? numValue + 'px' : pxToRem(numValue),
            originalName: num.name,
            referencedVarName: num.referencedVarName ? removeTypePrefix(num.referencedVarName, typePrefix) : null,
            originalIndex: num.originalIndex
        };

        if (numType === 'breakpoints') {
            if (num.isAlias) {
                breakpointsAliases.push(numData);
            } else {
                breakpointsPrimitives.push(numData);
            }
        } else if (numType === 'radius') {
            if (num.isAlias) {
                radiusAliases.push(numData);
            } else {
                radiusPrimitives.push(numData);
            }
        } else {
            if (num.isAlias) {
                spacingAliases.push(numData);
            } else {
                spacingPrimitives.push(numData);
            }
        }
    }

    // Sort by original Figma order instead of numeric value
    spacingPrimitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    spacingAliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    radiusPrimitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    radiusAliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    breakpointsPrimitives.sort(function(a, b) { return a.originalIndex - b.originalIndex; });
    breakpointsAliases.sort(function(a, b) { return a.originalIndex - b.originalIndex; });

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

    // Spacing map - primitives only
    if (spacingPrimitives.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// SPACING\n';
        variablesScss += '// ====================================\n\n';
        variablesScss += '$spacing: (\n';
        for (var sp = 0; sp < spacingPrimitives.length; sp++) {
            variablesScss += '        ' + spacingPrimitives[sp].key + ': ' + spacingPrimitives[sp].value;
            variablesScss += (sp < spacingPrimitives.length - 1) ? ',\n' : '\n';
        }
        variablesScss += ');\n\n';
    }

    // Radius map - primitives only
    if (radiusPrimitives.length > 0) {
        variablesScss += '// ====================================\n';
        variablesScss += '// BORDER RADIUS\n';
        variablesScss += '// ====================================\n\n';
        variablesScss += '$radius: (\n';
        for (var r = 0; r < radiusPrimitives.length; r++) {
            variablesScss += '        ' + radiusPrimitives[r].key + ': ' + radiusPrimitives[r].value;
            variablesScss += (r < radiusPrimitives.length - 1) ? ',\n' : '\n';
        }
        variablesScss += ');\n';
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
        rootScss += '  // Colors\n';
        rootScss += '  @each $key, $val in $colors {\n';
        rootScss += '    --color-#{$key}: #{$val};\n';
        rootScss += '  }\n\n';
    }

    // Spacing - primitives
    if (spacingPrimitives.length > 0) {
        rootScss += '  // Spacing\n';
        rootScss += '  @each $key, $val in $spacing {\n';
        rootScss += '    --spacing-#{$key}: #{$val};\n';
        rootScss += '  }\n\n';
    }

    // Radius - primitives
    if (radiusPrimitives.length > 0) {
        rootScss += '  // Border radius\n';
        rootScss += '  @each $key, $val in $radius {\n';
        rootScss += '    --radius-#{$key}: #{$val};\n';
        rootScss += '  }\n\n';
    }

    // Text styles
    if (textStyles.length > 0) {
        rootScss += '  // Font styles\n';
        for (var tsi = 0; tsi < textStyles.length; tsi++) {
            var style = textStyles[tsi];
            var fontSizeRem = pxToRem(style.fontSize);
            var folder = style.normalizedFolder || 'default';
            rootScss += '  --font-' + style.normalizedName + ': ' + style.fontWeightValue + ' ' + fontSizeRem + ' #{$family-' + folder + '};\n';
        }
        rootScss += '\n';
    }

    // Aliases section (semantic tokens)
    var hasAliases = colorAliases.length > 0 || spacingAliases.length > 0 || radiusAliases.length > 0 || filteredStringsAliases.length > 0;

    if (hasAliases) {
        rootScss += '  // ====================================\n';
        rootScss += '  // ALIASES (Semantic tokens)\n';
        rootScss += '  // ====================================\n\n';

        // Color aliases
        if (colorAliases.length > 0) {
            rootScss += '  // Colors\n';
            for (var ca = 0; ca < colorAliases.length; ca++) {
                var alias = colorAliases[ca];
                rootScss += '  --color-' + alias.key + ': var(--color-' + alias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }

        // Spacing aliases
        if (spacingAliases.length > 0) {
            rootScss += '  // Spacing\n';
            for (var sa = 0; sa < spacingAliases.length; sa++) {
                var alias = spacingAliases[sa];
                rootScss += '  --spacing-' + alias.key + ': var(--spacing-' + alias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }

        // Radius aliases
        if (radiusAliases.length > 0) {
            rootScss += '  // Border radius\n';
            for (var ra = 0; ra < radiusAliases.length; ra++) {
                var alias = radiusAliases[ra];
                rootScss += '  --radius-' + alias.key + ': var(--radius-' + alias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }

        // String aliases (excluding font families)
        if (filteredStringsAliases.length > 0) {
            rootScss += '  // Strings\n';
            for (var ssa = 0; ssa < filteredStringsAliases.length; ssa++) {
                var alias = filteredStringsAliases[ssa];
                rootScss += '  --' + alias.key + ': var(--' + alias.referencedVarName + ');\n';
            }
            rootScss += '\n';
        }
    }

    rootScss += '}\n';

    console.log('_variables.scss generated: ' + variablesScss.length + ' characters');
    console.log('_root.scss generated: ' + rootScss.length + ' characters');

    // Combine all for backward compatibility (using filtered strings)
    var allColorMap = colorPrimitives.concat(colorAliases);
    var allSpacingMap = spacingPrimitives.concat(spacingAliases);
    var allRadiusMap = radiusPrimitives.concat(radiusAliases);
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

// Listen to messages from UI
figma.ui.onmessage = async function(msg) {
    console.log('Message received:', msg);

    if (msg.type === 'cancel') {
        console.log('Closing plugin');
        figma.closePlugin();
        return;
    }

    if (msg.type === 'generate') {
        try {
            console.log('Starting generation');
            figma.notify('🔄 Extracting variables...', { timeout: 2000 });

            var data = await extractVariables(msg.options.onlyUsed, msg.options.selectedCollections);
            var scssFiles = generateScssFiles(data, msg.options);

            console.log('Sending files to UI');

            // Build files array
            var files = [
                {
                    filename: '_variables.scss',
                    content: scssFiles.variables
                },
                {
                    filename: '_root.scss',
                    content: scssFiles.root
                }
            ];

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