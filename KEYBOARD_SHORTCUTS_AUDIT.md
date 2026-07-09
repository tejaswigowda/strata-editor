# Keyboard Shortcuts Handler Audit

## Overview
This document maps all keyboard event listeners and shortcut handlers in the threejs.editor.enhanced codebase. These are the key locations where you need to add text-input focus checks.

---

## 1. **Main Global Shortcuts Handler** ⭐ PRIMARY
**File:** [docs/editor/js/Sidebar.Settings.Shortcuts.js](docs/editor/js/Sidebar.Settings.Shortcuts.js)

**Location:** Lines 101-176

**Description:** Global `document.addEventListener('keydown')` that handles most application shortcuts including:
- Undo/Redo: `Ctrl+Z` / `Ctrl+Shift+Z`
- Transform shortcuts: `Translate`, `Rotate`, `Scale`
- Delete/Backspace for object deletion
- Focus shortcut
- Group/Ungroup: `Ctrl+G` / `Ctrl+Shift+G`

**Key Code:**
```javascript
document.addEventListener( 'keydown', function ( event ) {

    switch ( event.key.toLowerCase() ) {

        case 'backspace':
        case 'delete':
            // Delete selected object
            break;

        case config.getKey( 'settings/shortcuts/translate' ):
        case config.getKey( 'settings/shortcuts/rotate' ):
        case config.getKey( 'settings/shortcuts/scale' ):
            // Transform shortcuts
            break;

        case config.getKey( 'settings/shortcuts/undo' ):
            if ( IS_MAC ? event.metaKey : event.ctrlKey ) {
                if ( event.shiftKey ) {
                    editor.redo();
                } else {
                    editor.undo();
                }
            }
            break;

        case 'g':
            if ( IS_MAC ? event.metaKey : event.ctrlKey ) {
                // Group/Ungroup
            }
            break;
    }

} );
```

**⚠️ ISSUE:** No check if user is focused on text input. This means Ctrl+Z will undo even when typing in a search box or editor.

**Fix Needed:**
```javascript
if ( event.target && ( event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' ) ) return;
```

---

## 2. **Edit Mode Keyboard Handler** ✅ ALREADY HAS CHECK
**File:** [docs/editor/js/mesh/EditModeController.js](docs/editor/js/mesh/EditModeController.js)

**Location:** Lines 556-579 (_attachKeys method)

**Description:** Handles keyboard shortcuts when in mesh editing mode:
- Tab/Escape: Exit edit mode
- 1/2/3: Switch between vertex/edge/face modes
- A: Select all / deselect

**Key Code:**
```javascript
this._keyHandler = ( e ) => {

    if ( ! this.active ) return;
    if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ) ) return;  // ✅ CHECK EXISTS

    switch ( e.key ) {
        case 'Tab':      e.preventDefault(); this.exit(); break;
        case 'Escape':   e.preventDefault(); this.exit(); break;
        case '1':        this.setMode( 'vertex' ); break;
        case '2':        this.setMode( 'edge' );   break;
        case '3':        this.setMode( 'face' );   break;
        case 'a': case 'A':
            if ( this.selection.count ) this.selection.clear();
            else this.selection.selectAll( this.em );
            break;
    }

};

document.addEventListener( 'keydown', this._keyHandler );
```

**✅ STATUS:** Already has the input/textarea check at line 559. Good pattern to follow!

---

## 3. **AI Input Handler** ✅ SCOPED CORRECTLY
**File:** [docs/editor/js/Shell.js](docs/editor/js/Shell.js)

**Location:** Lines 2465-2490 (AI input keydown)

**Description:** Handles keyboard input for the AI prompt input field:
- Escape: Interrupt AI stream
- Enter: Run AI command

**Key Code:**
```javascript
aiInput.addEventListener( 'keydown', function ( event ) {

    event.stopPropagation();  // ✅ Prevents global handler from firing

    if ( event.key === 'Escape' ) {
        event.preventDefault();
        if ( ! stopBtn.disabled ) {
            stopBtn.click();
        }
        return;
    }

    if ( event.key === 'Enter' ) {
        event.preventDefault();
        const val = aiInput.value.trim();
        if ( val ) {
            aiInput.value = '';
            runAI( val );
        }
    }

} );
```

**✅ STATUS:** Correctly uses `event.stopPropagation()` to prevent global shortcuts from interfering.

---

## 4. **JS Input Handler** ✅ SCOPED CORRECTLY
**File:** [docs/editor/js/Shell.js](docs/editor/js/Shell.js)

**Location:** Lines 2498-2545 (JS input keydown)

**Description:** Handles keyboard input for the JavaScript command input:
- Enter (without Shift): Execute command
- Arrow Up/Down: Navigate command history
- Escape: Clear input

**Key Code:**
```javascript
input.addEventListener( 'keydown', function ( event ) {

    event.stopPropagation();  // ✅ Prevents global handler from firing

    if ( event.key === 'Enter' && ! event.shiftKey ) {
        event.preventDefault();
        execute( input.value );
        input.value = '';
        return;
    }

    if ( event.key === 'ArrowUp' ) {
        event.preventDefault();
        if ( historyIndex < history.length - 1 ) {
            historyIndex++;
            input.value = history[ historyIndex ];
        }
    }

    if ( event.key === 'ArrowDown' ) {
        // Navigate history down
    }

} );
```

**✅ STATUS:** Correctly uses `event.stopPropagation()` to prevent global shortcuts.

---

## 5. **Menubar Edit Handler** ✅ INDIRECT
**File:** [docs/editor/js/Menubar.Edit.js](docs/editor/js/Menubar.Edit.js)

**Location:** Lines 25-60 (Undo/Redo menu items)

**Description:** Menubar UI items for undo/redo, triggered by clicks not keyboard directly.

**Key Code:**
```javascript
const undo = new UIRow();
undo.setClass( 'option' );
setMenuIcon( undo, 'undo', strings.getKey( 'menubar/edit/undo' ) + ' (Ctrl+Z)' );
undo.onClick( function () {
    editor.undo();  // Delegates to main undo function
} );

const redo = new UIRow();
redo.setClass( 'option' );
setMenuIcon( redo, 'redo', strings.getKey( 'menubar/edit/redo' ) + ' (Ctrl+Shift+Z)' );
redo.onClick( function () {
    editor.redo();  // Delegates to main redo function
} );
```

**✅ STATUS:** UI-driven, not keyboard-driven. The actual shortcut is handled in Sidebar.Settings.Shortcuts.js.

---

## 6. **APP Player Keyboard Events**
**File:** [docs/editor/js/libs/app.js](docs/editor/js/libs/app.js)

**Location:** Lines 231-232 (Event listeners), Lines 287-304 (Handlers)

**Description:** Generic keydown/keyup handlers for the 3D preview player. These dispatch to script event handlers registered in the scene.

**Key Code:**
```javascript
this.play = function () {
    document.addEventListener( 'keydown', onKeyDown );
    document.addEventListener( 'keyup', onKeyUp );
    // ... other listeners
};

function onKeyDown( event ) {
    dispatch( events.keydown, event );  // Dispatches to scene scripts
}

function onKeyUp( event ) {
    dispatch( events.keyup, event );  // Dispatches to scene scripts
}
```

**⚠️ POTENTIAL ISSUE:** These are generic dispatch handlers. If custom scripts are handling shortcuts, they may interfere with text inputs. This depends on what scripts are registered.

---

## Summary Table

| File | Handler | Line | Shortcuts | Text Input Check | Status |
|------|---------|------|-----------|------------------|--------|
| Sidebar.Settings.Shortcuts.js | Global keydown | 101 | Undo/Redo, Transform, Delete, Group | ❌ MISSING | ⚠️ NEEDS FIX |
| EditModeController.js | keydown | 556 | Tab, Escape, 1-3, A | ✅ HAS IT (559) | ✅ GOOD |
| Shell.js (AI) | keydown | 2465 | Escape, Enter | ✅ stopPropagation | ✅ GOOD |
| Shell.js (JS) | keydown | 2498 | Enter, Arrows, Escape | ✅ stopPropagation | ✅ GOOD |
| app.js | keydown | 231 | Generic dispatch | ⚠️ Script-dependent | ⚠️ CHECK |
| Menubar.Edit.js | onClick | 25 | Undo/Redo | N/A (UI-driven) | ✅ GOOD |

---

## Implementation Recommendation

### Primary Fix Location
**File:** `Sidebar.Settings.Shortcuts.js` (Line 101)

Add text input focus check at the beginning of the global keydown handler:

```javascript
document.addEventListener( 'keydown', function ( event ) {

    // ✅ ADD THIS CHECK
    if ( event.target && ( event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' ) ) {
        return;
    }

    // ... existing switch statement ...
    switch ( event.key.toLowerCase() ) {
        // ...
    }

} );
```

### Alternative Approach (More Comprehensive)
If you need to support `contenteditable` elements or other input types:

```javascript
function isInTextInput( element ) {
    if ( ! element ) return false;
    
    const tagName = element.tagName?.toUpperCase();
    if ( tagName === 'INPUT' || tagName === 'TEXTAREA' ) return true;
    
    // Also check for contenteditable
    if ( element.contentEditable === 'true' ) return true;
    if ( element.getAttribute( 'contenteditable' ) === 'true' ) return true;
    
    return false;
}

document.addEventListener( 'keydown', function ( event ) {

    if ( isInTextInput( event.target ) ) return;

    switch ( event.key.toLowerCase() ) {
        // ... rest of code
    }

} );
```

---

## Testing Checklist

After adding the fix, test these scenarios:

- [ ] Type Ctrl+Z in a search box → No undo, text input remains focused
- [ ] Type Ctrl+Z in the 3D viewport → Undo works
- [ ] Type in AI prompt with Ctrl+Z → No undo
- [ ] Type in JS input with Ctrl+Z → No undo
- [ ] Type in edit mode with Ctrl+Z → No undo (EditModeController already has check)
- [ ] Regular undo/redo outside inputs still works
- [ ] Delete key in text input doesn't delete scene objects
- [ ] Group (Ctrl+G) doesn't trigger in text inputs
