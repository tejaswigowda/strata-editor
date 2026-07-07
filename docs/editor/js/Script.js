import { UIElement, UIPanel, UIText } from './libs/ui.js';

import { SetScriptValueCommand } from './commands/SetScriptValueCommand.js';
import { SetMaterialValueCommand } from './commands/SetMaterialValueCommand.js';

function Script( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'script' );
	container.setPosition( 'absolute' );
	container.setBackgroundColor( '#272822' );
	container.setDisplay( 'none' );

	const header = new UIPanel();
	header.setPadding( '10px' );
	container.add( header );

	const title = new UIText().setColor( '#fff' );
	header.add( title );

	const buttonSVG = ( function () {

		const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		svg.setAttribute( 'width', 32 );
		svg.setAttribute( 'height', 32 );
		const path = document.createElementNS( 'http://www.w3.org/2000/svg', 'path' );
		path.setAttribute( 'd', 'M 12,12 L 22,22 M 22,12 12,22' );
		path.setAttribute( 'stroke', '#fff' );
		svg.appendChild( path );
		return svg;

	} )();

	const close = new UIElement( buttonSVG );
	close.setPosition( 'absolute' );
	close.setTop( '3px' );
	close.setRight( '1px' );
	close.setCursor( 'pointer' );
	close.onClick( function () {

		container.setDisplay( 'none' );

	} );
	header.add( close );


	let renderer;

	signals.rendererCreated.add( function ( newRenderer ) {

		renderer = newRenderer;

	} );


	let delay;
	let currentMode;
	let currentScript;
	let currentObject;
	let monacoEditor = null;
	let editorReady = new Promise( ( resolve ) => {

		// Initialize Monaco Editor when loader is ready
		require( [ 'vs/editor/editor.main' ], function () {

			monacoEditor = monaco.editor.create( container.dom, {
				value: '',
				language: 'javascript',
				lineNumbers: 'on',
				minimap: { enabled: false },
				theme: 'vs-dark',
				tabSize: 4,
				indentSize: 4,
				insertSpaces: false,
				readOnly: false,
				scrollBeyondLastLine: false,
				fontSize: 12,
				fontFamily: 'Consolas, "Courier New", monospace'
			} );

			// Adjust height to fill container
			setTimeout( () => {
				monacoEditor.layout();
			}, 100 );

			monacoEditor.onDidChangeModelContent( function () {

				clearTimeout( delay );
				delay = setTimeout( function () {

					const value = monacoEditor.getValue();

					if ( ! validate( value ) ) return;

					if ( typeof ( currentScript ) === 'object' ) {

						if ( value !== currentScript.source ) {

							editor.execute( new SetScriptValueCommand( editor, currentObject, currentScript, 'source', value ) );

						}

						return;

					}

					if ( currentScript !== 'programInfo' ) return;

					const json = JSON.parse( value );

					if ( JSON.stringify( currentObject.material.defines ) !== JSON.stringify( json.defines ) ) {

						const cmd = new SetMaterialValueCommand( editor, currentObject, 'defines', json.defines );
						cmd.updatable = false;
						editor.execute( cmd );

					}

				if ( JSON.stringify( currentObject.material.uniforms ) !== JSON.stringify( json.uniforms ) ) {

					const cmd = new SetMaterialValueCommand( editor, currentObject, 'uniforms', json.uniforms );
					cmd.updatable = false;
					editor.execute( cmd );

				}

				if ( JSON.stringify( currentObject.material.attributes ) !== JSON.stringify( json.attributes ) ) {

					const cmd = new SetMaterialValueCommand( editor, currentObject, 'attributes', json.attributes );
					cmd.updatable = false;
					editor.execute( cmd );

				}

			}, 300 );

		} );

		// prevent backspace from deleting objects
		const wrapper = monacoEditor.getDomNode();
		wrapper.addEventListener( 'keydown', function ( event ) {

			event.stopPropagation();

		} );

		resolve();

		} );

	} );

	// validate

	const decorations = [];

	const validate = function ( string ) {

		let valid;
		let errors = [];
		const newDecorations = [];

		switch ( currentMode ) {

			case 'javascript':

				try {

					const syntax = esprima.parse( string, { tolerant: true } );
					errors = syntax.errors;

				} catch ( error ) {

					errors.push( {

						lineNumber: error.lineNumber - 1,
						message: error.message

					} );

				}

				for ( let i = 0; i < errors.length; i ++ ) {

					const error = errors[ i ];
					error.message = error.message.replace( /Line [0-9]+: /, '' );

				}

				break;

			case 'json':

				errors = [];

				jsonlint.parseError = function ( message, info ) {

					message = message.split( '\n' )[ 3 ];

					errors.push( {

						lineNumber: info.loc.first_line - 1,
						message: message

					} );

				};

				try {

					jsonlint.parse( string );

				} catch ( error ) {

					// ignore failed error recovery

				}

				break;

			case 'glsl':

				currentObject.material[ currentScript ] = string;
				currentObject.material.needsUpdate = true;
				signals.materialChanged.dispatch( currentObject, 0 ); // TODO: Add multi-material support

				const programs = renderer.info.programs;

				valid = true;
				const parseMessage = /^(?:ERROR|WARNING): \d+:(\d+): (.*)/g;

				for ( let i = 0, n = programs.length; i !== n; ++ i ) {

					const diagnostics = programs[ i ].diagnostics;

					if ( diagnostics === undefined ||
							diagnostics.material !== currentObject.material ) continue;

					if ( ! diagnostics.runnable ) valid = false;

					const shaderInfo = diagnostics[ currentScript ];
					const lineOffset = shaderInfo.prefix.split( /\r\n|\r|\n/ ).length;

					while ( true ) {

						const parseResult = parseMessage.exec( shaderInfo.log );
						if ( parseResult === null ) break;

						errors.push( {

							lineNumber: parseResult[ 1 ] - lineOffset,
							message: parseResult[ 2 ]

						} );

					} // messages

					break;

				} // programs

		} // mode switch

		// Add error decorations if editor exists
		if ( monacoEditor ) {

			for ( let i = 0; i < errors.length; i ++ ) {

				const error = errors[ i ];
				const lineNumber = Math.max( error.lineNumber + 1, 1 );

				newDecorations.push( {
					range: new monaco.Range( lineNumber, 1, lineNumber, 1 ),
					options: {
						isWholeLine: true,
						className: 'errorLine',
						glyphMarginClassName: 'fas fa-times-circle',
						glyphMarginHoverMessage: { value: error.message }
					}
				} );

			}

			monacoEditor.deltaDecorations( decorations, newDecorations );
			decorations.length = 0;
			decorations.push( ...newDecorations.map( d => d.range ) );

		}

		return valid !== undefined ? valid : errors.length === 0;

	};

	// Monaco IntelliSense is built-in and doesn't require additional configuration

	//

	signals.editorCleared.add( function () {

		container.setDisplay( 'none' );

	} );

	function setTitle( object, script ) {

		if ( typeof script === 'object' ) {

			title.setValue( object.name + ' / ' + script.name );

		} else {

			switch ( script ) {

				case 'vertexShader':

					title.setValue( object.material.name + ' / ' + strings.getKey( 'script/title/vertexShader' ) );
					break;

				case 'fragmentShader':

					title.setValue( object.material.name + ' / ' + strings.getKey( 'script/title/fragmentShader' ) );
					break;

				case 'programInfo':

					title.setValue( object.material.name + ' / ' + strings.getKey( 'script/title/programInfo' ) );
					break;

				default:

					throw new Error( 'setTitle: Unknown script' );

			}

		}

	}

	signals.editScript.add( async function ( object, script ) {

		let mode, source;

		if ( typeof ( script ) === 'object' ) {

			mode = 'javascript';
			source = script.source;

		} else {

			switch ( script ) {

				case 'vertexShader':

					mode = 'glsl';
					source = object.material.vertexShader || '';

					break;

				case 'fragmentShader':

					mode = 'glsl';
					source = object.material.fragmentShader || '';

					break;

				case 'programInfo':

					mode = 'json';
					const json = {
						defines: object.material.defines,
						uniforms: object.material.uniforms,
						attributes: object.material.attributes
					};
					source = JSON.stringify( json, null, '\t' );

					break;

				default:

					throw new Error( 'editScript: Unknown script' );

			}

		}

		setTitle( object, script );

		currentMode = mode;
		currentScript = script;
		currentObject = object;

		container.setDisplay( '' );

		await editorReady;

		if ( monacoEditor ) {

			// Set the code value
			monacoEditor.getModel().setValue( source );

			// Set the language based on mode
			let language = 'javascript';
			if ( mode === 'glsl' ) {
				language = 'glsl';
			} else if ( mode === 'json' || ( typeof mode === 'object' && mode.json ) ) {
				language = 'json';
			}
			monaco.editor.setModelLanguage( monacoEditor.getModel(), language );

		}

	} );

	signals.scriptRemoved.add( function ( script ) {

		if ( currentScript === script ) {

			container.setDisplay( 'none' );

		}

	} );

	signals.objectChanged.add( function ( object ) {

		if ( object !== currentObject ) return;

		if ( [ 'programInfo', 'vertexShader', 'fragmentShader' ].includes( currentScript ) ) return;

		setTitle( currentObject, currentScript );

	} );

	signals.scriptChanged.add( function ( script ) {

		if ( script === currentScript ) {

			setTitle( currentObject, currentScript );

		}

	} );

	signals.materialChanged.add( function ( object/*, slot */ ) {

		if ( object !== currentObject ) return;

		// TODO: Adds multi-material support

		setTitle( currentObject, currentScript );

	} );

	return container;

}

export { Script };
