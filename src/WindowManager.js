/**
 * Window managers are used to open and close {@link OO.ui.Window windows} and control their
 * presentation. Managed windows are mutually exclusive. If a new window is opened while a current
 * window is opening or is opened, the current window will be closed and any on-going
 * {@link OO.ui.Process process} will be cancelled. Windows
 * themselves are persistent and—rather than being torn down when closed—can be repopulated with the
 * pertinent data and reused.
 *
 * Over the lifecycle of a window, the window manager makes available three promises: `opening`,
 * `opened`, and `closing`, which represent the primary stages of the cycle:
 *
 * **Opening**: the opening stage begins when the window manager’s #openWindow or a window’s
 * {@link OO.ui.Window#open open} method is used, and the window manager begins to open the window.
 *
 * - an `opening` event is emitted with an `opening` promise
 * - the #getSetupDelay method is called and the returned value is used to time a pause in execution
 *   before the window’s {@link OO.ui.Window#method-setup setup} method is called which executes
 *   OO.ui.Window#getSetupProcess.
 * - a `setup` progress notification is emitted from the `opening` promise
 * - the #getReadyDelay method is called the returned value is used to time a pause in execution
 *   before the window’s {@link OO.ui.Window#method-ready ready} method is called which executes
 *   OO.ui.Window#getReadyProcess.
 * - a `ready` progress notification is emitted from the `opening` promise
 * - the `opening` promise is resolved with an `opened` promise
 *
 * **Opened**: the window is now open.
 *
 * **Closing**: the closing stage begins when the window manager's #closeWindow or the
 * window's {@link OO.ui.Window#close close} methods is used, and the window manager begins
 * to close the window.
 *
 * - the `opened` promise is resolved with `closing` promise and a `closing` event is emitted
 * - the #getHoldDelay method is called and the returned value is used to time a pause in execution
 *   before the window's {@link OO.ui.Window#getHoldProcess getHoldProcess} method is called on the
 *   window and its result executed
 * - a `hold` progress notification is emitted from the `closing` promise
 * - the #getTeardownDelay() method is called and the returned value is used to time a pause in
 *   execution before the window's {@link OO.ui.Window#getTeardownProcess getTeardownProcess} method
 *   is called on the window and its result executed
 * - a `teardown` progress notification is emitted from the `closing` promise
 * - the `closing` promise is resolved. The window is now closed
 *
 * See the [OOUI documentation on MediaWiki][1] for more information.
 *
 * [1]: https://www.mediawiki.org/wiki/OOUI/Windows/Window_managers
 *
 * @class
 * @extends OO.ui.Element
 * @mixins OO.EventEmitter
 *
 * @constructor
 * @param {Object} [config] Configuration options
 * @cfg {OO.Factory} [factory] Window factory to use for automatic instantiation
 *  Note that window classes that are instantiated with a factory must have
 *  a {@link OO.ui.Dialog#static-name static name} property that specifies a symbolic name.
 * @cfg {boolean} [modal=true] Prevent interaction outside the current window
 * @cfg {boolean} [forceTrapFocus] Force the trapping of focus within windows. This is done
 *  automatically for modal window managers and full screen windows.
 */
OO.ui.WindowManager = function OoUiWindowManager( config ) {
	// Configuration initialization
	config = config || {};

	// Parent constructor
	OO.ui.WindowManager.super.call( this, config );

	// Mixin constructors
	OO.EventEmitter.call( this );

	// Properties
	this.factory = config.factory;
	this.modal = config.modal === undefined || !!config.modal;
	this.windows = {};
	// Deprecated placeholder promise given to compatOpening in openWindow()
	// that is resolved in closeWindow().
	this.compatOpened = null;
	this.preparingToOpen = null;
	this.preparingToClose = null;
	this.currentWindow = null;
	this.globalEvents = false;
	this.$returnFocusTo = null;
	this.isolated = false;
	this.$ariaHidden = null;
	this.$inert = null;
	this.onWindowResizeTimeout = null;
	this.onWindowResizeHandler = this.onWindowResize.bind( this );
	this.afterWindowResizeHandler = this.afterWindowResize.bind( this );
	this.onWindowFocusHandler = this.onWindowFocus.bind( this );

	// Initialization
	this.$element
		.addClass( 'oo-ui-windowManager' )
		.toggleClass( 'oo-ui-windowManager-modal', this.modal )
		.toggleClass( 'oo-ui-windowManager-forceTrapFocus', !!config.forceTrapFocus );
	if ( this.modal ) {
		this.$element
			.attr( 'aria-hidden', 'true' )
			.attr( 'inert', '' );
	}
};

/* Setup */

OO.inheritClass( OO.ui.WindowManager, OO.ui.Element );
OO.mixinClass( OO.ui.WindowManager, OO.EventEmitter );

/* Events */

/**
 * An 'opening' event is emitted when the window begins to be opened.
 *
 * @event opening
 * @param {OO.ui.Window} win Window that's being opened
 * @param {jQuery.Promise} opened A promise resolved with a value when the window is opened
 *  successfully. This promise also emits `setup` and `ready` notifications. When this promise is
 *  resolved, the first argument of the value is an 'closed' promise, the second argument is the
 *  opening data.
 * @param {Object} data Window opening data
 */

/**
 * A 'closing' event is emitted when the window begins to be closed.
 *
 * @event closing
 * @param {OO.ui.Window} win Window that's being closed
 * @param {jQuery.Promise} closed A promise resolved with a value when the window is closed
 *  successfully. This promise also emits `hold` and `teardown` notifications. When this promise is
 *  resolved, the first argument of its value is the closing data.
 * @param {Object} data Window closing data
 */

/**
 * A 'resize' event is emitted when a window is resized.
 *
 * @event resize
 * @param {OO.ui.Window} win Window that was resized
 */

/* Static Properties */

/**
 * Map of the symbolic name of each window size and its CSS properties.
 *
 * @static
 * @inheritable
 * @property {Object}
 */
OO.ui.WindowManager.static.sizes = {
	small: {
		width: 300
	},
	medium: {
		width: 500
	},
	large: {
		width: 700
	},
	larger: {
		width: 900
	},
	full: {
		// These can be non-numeric because they are never used in calculations
		width: '100%',
		height: '100%'
	}
};

/**
 * Symbolic name of the default window size.
 *
 * The default size is used if the window's requested size is not recognized.
 *
 * @static
 * @inheritable
 * @property {string}
 */
OO.ui.WindowManager.static.defaultSize = 'medium';

/* Methods */

/**
 * Check if the window manager is modal, preventing interaction outside the current window
 *
 * @return {boolean} The window manager is modal
 */
OO.ui.WindowManager.prototype.isModal = function () {
	return this.modal;
};

/**
 * Handle window resize events.
 *
 * @private
 * @param {jQuery.Event} e Window resize event
 */
OO.ui.WindowManager.prototype.onWindowResize = function () {
	clearTimeout( this.onWindowResizeTimeout );
	this.onWindowResizeTimeout = setTimeout( this.afterWindowResizeHandler, 200 );
};

/**
 * Handle window focus events.
 *
 * @private
 * @param {jQuery.Event} e Window focus event
 */
OO.ui.WindowManager.prototype.onWindowFocus = function () {
	var currentWindow = this.getCurrentWindow();
	if (
		// This event should only be bound while a window is open
		currentWindow &&
		// Focus can be moved outside the window focus traps but pressing tab
		// from the address bar (T307995). When this happens move focus back
		// to the start of the current window.
		!OO.ui.contains( currentWindow.$element[ 0 ], document.activeElement )
	) {
		currentWindow.focus();
	}
};

/**
 * Handle window resize events.
 *
 * @private
 * @param {jQuery.Event} e Window resize event
 */
OO.ui.WindowManager.prototype.afterWindowResize = function () {
	var currentFocusedElement = document.activeElement;
	if ( this.currentWindow ) {
		this.updateWindowSize( this.currentWindow );

		// Restore focus to the original element if it has changed.
		// When a layout change is made on resize inputs lose focus
		// on Android (Chrome and Firefox), see T162127.
		if ( currentFocusedElement !== document.activeElement ) {
			currentFocusedElement.focus();
		}
	}
};

/**
 * Check if window is opening.
 *
 * @param {OO.ui.Window} win Window to check
 * @return {boolean} Window is opening
 */
OO.ui.WindowManager.prototype.isOpening = function ( win ) {
	return win === this.currentWindow && !!this.lifecycle &&
		this.lifecycle.isOpening();
};

/**
 * Check if window is closing.
 *
 * @param {OO.ui.Window} win Window to check
 * @return {boolean} Window is closing
 */
OO.ui.WindowManager.prototype.isClosing = function ( win ) {
	return win === this.currentWindow && !!this.lifecycle &&
		this.lifecycle.isClosing();
};

/**
 * Check if window is opened.
 *
 * @param {OO.ui.Window} win Window to check
 * @return {boolean} Window is opened
 */
OO.ui.WindowManager.prototype.isOpened = function ( win ) {
	return win === this.currentWindow && !!this.lifecycle &&
		this.lifecycle.isOpened();
};

/**
 * Check if a window is being managed.
 *
 * @param {OO.ui.Window} win Window to check
 * @return {boolean} Window is being managed
 */
OO.ui.WindowManager.prototype.hasWindow = function ( win ) {
	for ( var name in this.windows ) {
		if ( this.windows[ name ] === win ) {
			return true;
		}
	}

	return false;
};

/**
 * Get the number of milliseconds to wait after opening begins before executing the ‘setup’ process.
 *
 * @param {OO.ui.Window} win Window being opened
 * @param {Object} [data] Window opening data
 * @return {number} Milliseconds to wait
 */
OO.ui.WindowManager.prototype.getSetupDelay = function () {
	return 0;
};

/**
 * Get the number of milliseconds to wait after setup has finished before executing the ‘ready’
 * process.
 *
 * @param {OO.ui.Window} win Window being opened
 * @param {Object} [data] Window opening data
 * @return {number} Milliseconds to wait
 */
OO.ui.WindowManager.prototype.getReadyDelay = function () {
	return this.modal ? OO.ui.theme.getDialogTransitionDuration() : 0;
};

/**
 * Get the number of milliseconds to wait after closing has begun before executing the 'hold'
 * process.
 *
 * @param {OO.ui.Window} win Window being closed
 * @param {Object} [data] Window closing data
 * @return {number} Milliseconds to wait
 */
OO.ui.WindowManager.prototype.getHoldDelay = function () {
	return 0;
};

/**
 * Get the number of milliseconds to wait after the ‘hold’ process has finished before
 * executing the ‘teardown’ process.
 *
 * @param {OO.ui.Window} win Window being closed
 * @param {Object} [data] Window closing data
 * @return {number} Milliseconds to wait
 */
OO.ui.WindowManager.prototype.getTeardownDelay = function () {
	return this.modal ? OO.ui.theme.getDialogTransitionDuration() : 0;
};

/**
 * Get a window by its symbolic name.
 *
 * If the window is not yet instantiated and its symbolic name is recognized by a factory, it will
 * be instantiated and added to the window manager automatically. Please see the [OOUI documentation
 * on MediaWiki][3] for more information about using factories.
 * [3]: https://www.mediawiki.org/wiki/OOUI/Windows/Window_managers
 *
 * @param {string} name Symbolic name of the window
 * @return {jQuery.Promise} Promise resolved with matching window, or rejected with an OO.ui.Error
 * @throws {Error} An error is thrown if the symbolic name is not recognized by the factory.
 * @throws {Error} An error is thrown if the named window is not recognized as a managed window.
 */
OO.ui.WindowManager.prototype.getWindow = function ( name ) {
	var deferred = $.Deferred(),
		win = this.windows[ name ];

	if ( !( win instanceof OO.ui.Window ) ) {
		if ( this.factory ) {
			if ( !this.factory.lookup( name ) ) {
				deferred.reject( new OO.ui.Error(
					'Cannot auto-instantiate window: symbolic name is unrecognized by the factory'
				) );
			} else {
				win = this.factory.create( name );
				this.addWindows( [ win ] );
				deferred.resolve( win );
			}
		} else {
			deferred.reject( new OO.ui.Error(
				'Cannot get unmanaged window: symbolic name unrecognized as a managed window'
			) );
		}
	} else {
		deferred.resolve( win );
	}

	return deferred.promise();
};

/**
 * Get current window.
 *
 * @return {OO.ui.Window|null} Currently opening/opened/closing window
 */
OO.ui.WindowManager.prototype.getCurrentWindow = function () {
	return this.currentWindow;
};

/**
 * Open a window.
 *
 * @param {OO.ui.Window|string} win Window object or symbolic name of window to open
 * @param {Object} [data] Window opening data
 * @param {jQuery|null} [data.$returnFocusTo] Element to which the window will return focus when
 *  closed. Defaults the current activeElement. If set to null, focus isn't changed on close.
 * @param {OO.ui.WindowInstance} [lifecycle] Used internally
 * @param {jQuery.Deferred} [compatOpening] Used internally
 * @return {OO.ui.WindowInstance} A lifecycle object representing this particular
 *  opening of the window. For backwards-compatibility, then object is also a Thenable that is
 *  resolved when the window is done opening, with nested promise for when closing starts. This
 *  behaviour is deprecated and is not compatible with jQuery 3, see T163510.
 * @fires opening
 */
OO.ui.WindowManager.prototype.openWindow = function ( win, data, lifecycle, compatOpening ) {
	var manager = this;
	data = data || {};

	// Internal parameter 'lifecycle' allows this method to always return
	// a lifecycle even if the window still needs to be created
	// asynchronously when 'win' is a string.
	lifecycle = lifecycle || new OO.ui.WindowInstance();
	compatOpening = compatOpening || $.Deferred();

	// Turn lifecycle into a Thenable for backwards-compatibility with
	// the deprecated nested-promise behaviour, see T163510.
	[ 'state', 'always', 'catch', 'pipe', 'then', 'promise', 'progress', 'done', 'fail' ]
		.forEach( function ( method ) {
			lifecycle[ method ] = function () {
				OO.ui.warnDeprecation(
					'Using the return value of openWindow as a promise is deprecated. ' +
					'Use .openWindow( ... ).opening.' + method + '( ... ) instead.'
				);
				return compatOpening[ method ].apply( this, arguments );
			};
		} );

	// Argument handling
	if ( typeof win === 'string' ) {
		this.getWindow( win ).then(
			function ( w ) {
				manager.openWindow( w, data, lifecycle, compatOpening );
			},
			function ( err ) {
				lifecycle.deferreds.opening.reject( err );
			}
		);
		return lifecycle;
	}

	// Error handling
	var error;
	if ( !this.hasWindow( win ) ) {
		error = 'Cannot open window: window is not attached to manager';
	} else if ( this.lifecycle && this.lifecycle.isOpened() ) {
		error = 'Cannot open window: another window is open';
	} else if ( this.preparingToOpen || ( this.lifecycle && this.lifecycle.isOpening() ) ) {
		error = 'Cannot open window: another window is opening';
	}

	if ( error ) {
		compatOpening.reject( new OO.ui.Error( error ) );
		lifecycle.deferreds.opening.reject( new OO.ui.Error( error ) );
		return lifecycle;
	}

	// If a window is currently closing, wait for it to complete
	this.preparingToOpen = $.when( this.lifecycle && this.lifecycle.closed );
	// Ensure handlers get called after preparingToOpen is set
	this.preparingToOpen.done( function () {
		if ( manager.modal ) {
			manager.toggleGlobalEvents( true );
			manager.toggleIsolation( true );
		}
		manager.$returnFocusTo = data.$returnFocusTo !== undefined ?
			data.$returnFocusTo :
			$( document.activeElement );
		manager.currentWindow = win;
		manager.lifecycle = lifecycle;
		manager.preparingToOpen = null;
		manager.emit( 'opening', win, compatOpening, data );
		lifecycle.deferreds.opening.resolve( data );
		setTimeout( function () {
			manager.compatOpened = $.Deferred();
			win.setup( data ).then( function () {
				compatOpening.notify( { state: 'setup' } );
				setTimeout( function () {
					win.ready( data ).then( function () {
						compatOpening.notify( { state: 'ready' } );
						lifecycle.deferreds.opened.resolve( data );
						compatOpening.resolve( manager.compatOpened.promise(), data );
						manager.togglePreventIosScrolling( true );
					}, function ( dataOrErr ) {
						lifecycle.deferreds.opened.reject();
						compatOpening.reject();
						manager.closeWindow( win );
						if ( dataOrErr instanceof Error ) {
							setTimeout( function () {
								throw dataOrErr;
							} );
						}
					} );
				}, manager.getReadyDelay() );
			}, function ( dataOrErr ) {
				lifecycle.deferreds.opened.reject();
				compatOpening.reject();
				manager.closeWindow( win );
				if ( dataOrErr instanceof Error ) {
					setTimeout( function () {
						throw dataOrErr;
					} );
				}
			} );
		}, manager.getSetupDelay() );
	} );

	return lifecycle;
};

/**
 * Close a window.
 *
 * @param {OO.ui.Window|string} win Window object or symbolic name of window to close
 * @param {Object} [data] Window closing data
 * @return {OO.ui.WindowInstance} A lifecycle object representing this particular
 *  opening of the window. For backwards-compatibility, the object is also a Thenable that is
 *  resolved when the window is done closing, see T163510.
 * @fires closing
 */
OO.ui.WindowManager.prototype.closeWindow = function ( win, data ) {
	var manager = this,
		compatClosing = $.Deferred(),
		lifecycle = this.lifecycle;

	// Argument handling
	if ( typeof win === 'string' ) {
		win = this.windows[ win ];
	} else if ( !this.hasWindow( win ) ) {
		win = null;
	}

	// Error handling
	var error;
	if ( !lifecycle ) {
		error = 'Cannot close window: no window is currently open';
	} else if ( !win ) {
		error = 'Cannot close window: window is not attached to manager';
	} else if ( win !== this.currentWindow || this.lifecycle.isClosed() ) {
		error = 'Cannot close window: window already closed with different data';
	} else if ( this.preparingToClose || this.lifecycle.isClosing() ) {
		error = 'Cannot close window: window already closing with different data';
	}

	if ( error ) {
		// This function was called for the wrong window and we don't want to mess with the current
		// window's state.
		lifecycle = new OO.ui.WindowInstance();
		// Pretend the window has been opened, so that we can pretend to fail to close it.
		lifecycle.deferreds.opening.resolve( {} );
		lifecycle.deferreds.opened.resolve( {} );
	}

	// Turn lifecycle into a Thenable for backwards-compatibility with
	// the deprecated nested-promise behaviour, see T163510.
	[ 'state', 'always', 'catch', 'pipe', 'then', 'promise', 'progress', 'done', 'fail' ]
		.forEach( function ( method ) {
			lifecycle[ method ] = function () {
				OO.ui.warnDeprecation(
					'Using the return value of closeWindow as a promise is deprecated. ' +
					'Use .closeWindow( ... ).closed.' + method + '( ... ) instead.'
				);
				return compatClosing[ method ].apply( this, arguments );
			};
		} );

	if ( error ) {
		compatClosing.reject( new OO.ui.Error( error ) );
		lifecycle.deferreds.closing.reject( new OO.ui.Error( error ) );
		return lifecycle;
	}

	// If the window is currently opening, close it when it's done
	this.preparingToClose = $.when( this.lifecycle.opened );
	// Ensure handlers get called after preparingToClose is set
	this.preparingToClose.always( function () {
		manager.preparingToClose = null;
		manager.emit( 'closing', win, compatClosing, data );
		lifecycle.deferreds.closing.resolve( data );
		var compatOpened = manager.compatOpened;
		manager.compatOpened = null;
		compatOpened.resolve( compatClosing.promise(), data );
		manager.togglePreventIosScrolling( false );
		setTimeout( function () {
			win.hold( data ).then( function () {
				compatClosing.notify( { state: 'hold' } );
				setTimeout( function () {
					win.teardown( data ).then( function () {
						compatClosing.notify( { state: 'teardown' } );
						if ( manager.modal ) {
							manager.toggleGlobalEvents( false );
							manager.toggleIsolation( false );
						}
						if ( manager.$returnFocusTo && manager.$returnFocusTo.length ) {
							manager.$returnFocusTo[ 0 ].focus();
						}
						manager.currentWindow = null;
						manager.lifecycle = null;
						lifecycle.deferreds.closed.resolve( data );
						compatClosing.resolve( data );
					} );
				}, manager.getTeardownDelay() );
			} );
		}, manager.getHoldDelay() );
	} );

	return lifecycle;
};

/**
 * Add windows to the window manager.
 *
 * Windows can be added by reference, symbolic name, or explicitly defined symbolic names.
 * See the [OOUI documentation on MediaWiki] [2] for examples.
 * [2]: https://www.mediawiki.org/wiki/OOUI/Windows/Window_managers
 *
 * This function can be called in two manners:
 *
 * 1. `.addWindows( [ winA, winB, ... ] )` (where `winA`, `winB` are OO.ui.Window objects)
 *
 *    This syntax registers windows under the symbolic names defined in their `.static.name`
 *    properties. For example, if `windowA.constructor.static.name` is `'nameA'`, calling
 *    `.openWindow( 'nameA' )` afterwards will open the window `windowA`. This syntax requires the
 *    static name to be set, otherwise an exception will be thrown.
 *
 *    This is the recommended way, as it allows for an easier switch to using a window factory.
 *
 * 2. `.addWindows( { nameA: winA, nameB: winB, ... } )`
 *
 *    This syntax registers windows under the explicitly given symbolic names. In this example,
 *    calling `.openWindow( 'nameA' )` afterwards will open the window `windowA`, regardless of what
 *    its `.static.name` is set to. The static name is not required to be set.
 *
 *    This should only be used if you need to override the default symbolic names.
 *
 * Example:
 *
 *     var windowManager = new OO.ui.WindowManager();
 *     $( document.body ).append( windowManager.$element );
 *
 *     // Add a window under the default name: see OO.ui.MessageDialog.static.name
 *     windowManager.addWindows( [ new OO.ui.MessageDialog() ] );
 *     // Add a window under an explicit name
 *     windowManager.addWindows( { myMessageDialog: new OO.ui.MessageDialog() } );
 *
 *     // Open window by default name
 *     windowManager.openWindow( 'message' );
 *     // Open window by explicitly given name
 *     windowManager.openWindow( 'myMessageDialog' );
 *
 *
 * @param {Object.<string,OO.ui.Window>|OO.ui.Window[]} windows An array of window objects specified
 *  by reference, symbolic name, or explicitly defined symbolic names.
 * @throws {Error} An error is thrown if a window is added by symbolic name, but has neither an
 *  explicit nor a statically configured symbolic name.
 */
OO.ui.WindowManager.prototype.addWindows = function ( windows ) {
	var list;
	if ( Array.isArray( windows ) ) {
		// Convert to map of windows by looking up symbolic names from static configuration
		list = {};
		for ( var i = 0, len = windows.length; i < len; i++ ) {
			var name = windows[ i ].constructor.static.name;
			if ( !name ) {
				throw new Error( 'Windows must have a `name` static property defined.' );
			}
			list[ name ] = windows[ i ];
		}
	} else if ( OO.isPlainObject( windows ) ) {
		list = windows;
	}

	// Add windows
	for ( var n in list ) {
		var win = list[ n ];
		this.windows[ n ] = win.toggle( false );
		this.$element.append( win.$element );
		win.setManager( this );
	}
};

/**
 * Remove the specified windows from the windows manager.
 *
 * Windows will be closed before they are removed. If you wish to remove all windows, you may wish
 * to use the #clearWindows method instead. If you no longer need the window manager and want to
 * ensure that it no longer listens to events, use the #destroy method.
 *
 * @param {string[]} names Symbolic names of windows to remove
 * @return {jQuery.Promise} Promise resolved when window is closed and removed
 * @throws {Error} An error is thrown if the named windows are not managed by the window manager.
 */
OO.ui.WindowManager.prototype.removeWindows = function ( names ) {
	var manager = this;

	function cleanup( name, win ) {
		delete manager.windows[ name ];
		win.$element.detach();
	}

	var promises = names.map( function ( name ) {
		var cleanupWindow,
			win = manager.windows[ name ];
		if ( !win ) {
			throw new Error( 'Cannot remove window' );
		}
		cleanupWindow = cleanup.bind( null, name, win );
		return manager.closeWindow( name ).closed.then( cleanupWindow, cleanupWindow );
	} );

	return $.when.apply( $, promises );
};

/**
 * Remove all windows from the window manager.
 *
 * Windows will be closed before they are removed. Note that the window manager, though not in use,
 * will still listen to events. If the window manager will not be used again, you may wish to use
 * the #destroy method instead. To remove just a subset of windows, use the #removeWindows method.
 *
 * @return {jQuery.Promise} Promise resolved when all windows are closed and removed
 */
OO.ui.WindowManager.prototype.clearWindows = function () {
	return this.removeWindows( Object.keys( this.windows ) );
};

/**
 * Set dialog size. In general, this method should not be called directly.
 *
 * Fullscreen mode will be used if the dialog is too wide to fit in the screen.
 *
 * @param {OO.ui.Window} win Window to update, should be the current window
 * @chainable
 * @return {OO.ui.WindowManager} The manager, for chaining
 */
OO.ui.WindowManager.prototype.updateWindowSize = function ( win ) {
	// Bypass for non-current, and thus invisible, windows
	if ( win !== this.currentWindow ) {
		return;
	}

	var isFullscreen = win.getSize() === 'full';

	this.$element.toggleClass( 'oo-ui-windowManager-fullscreen', isFullscreen );
	this.$element.toggleClass( 'oo-ui-windowManager-floating', !isFullscreen );
	win.setDimensions( win.getSizeProperties() );

	this.emit( 'resize', win );

	return this;
};

/**
 * Prevent scrolling of the document on iOS devices that don't respect `body { overflow: hidden; }`.
 *
 * This function is called when the window is opened (ready), and so the background is covered up,
 * and the user won't see that we're doing weird things to the scroll position.
 *
 * @private
 * @param {boolean} on
 * @chainable
 * @return {OO.ui.WindowManager} The manager, for chaining
 */
OO.ui.WindowManager.prototype.togglePreventIosScrolling = function ( on ) {
	var isIos = /ipad|iphone|ipod/i.test( navigator.userAgent ),
		$body = $( this.getElementDocument().body ),
		stackDepth = $body.data( 'windowManagerGlobalEvents' ) || 0;

	// Only if this is the first/last WindowManager (see #toggleGlobalEvents)
	if ( !isIos || stackDepth !== 1 ) {
		return this;
	}

	var scrollableRoot = OO.ui.Element.static.getRootScrollableElement( $body[ 0 ] );

	if ( on ) {
		// We can't apply this workaround for non-fullscreen dialogs, because the user would see the
		// scroll position change. If they have content that needs scrolling, you're out of luck…
		// Always remember the scroll position in case dialog is closed with different size.
		this.iosOrigScrollPosition = scrollableRoot.scrollTop;
		if ( this.getCurrentWindow().getSize() === 'full' ) {
			$body.add( $body.parent() ).addClass( 'oo-ui-windowManager-ios-modal-ready' );
		}
	} else {
		// Always restore ability to scroll in case dialog was opened with different size.
		$body.add( $body.parent() ).removeClass( 'oo-ui-windowManager-ios-modal-ready' );
		if ( this.getCurrentWindow().getSize() === 'full' ) {
			scrollableRoot.scrollTop = this.iosOrigScrollPosition;
		}
	}
	return this;
};

/**
 * Bind or unbind global events for scrolling/focus.
 *
 * @private
 * @param {boolean} [on] Bind global events
 * @chainable
 * @return {OO.ui.WindowManager} The manager, for chaining
 */
OO.ui.WindowManager.prototype.toggleGlobalEvents = function ( on ) {
	var $body = $( this.getElementDocument().body );
	var $window = $( this.getElementWindow() );
	// We could have multiple window managers open so only modify
	// the body css at the bottom of the stack
	var stackDepth = $body.data( 'windowManagerGlobalEvents' ) || 0;

	on = on === undefined ? !!this.globalEvents : !!on;

	if ( on ) {
		if ( !this.globalEvents ) {
			$window.on( {
				// Start listening for top-level window dimension changes
				'orientationchange resize': this.onWindowResizeHandler,
				focus: this.onWindowFocusHandler
			} );
			if ( stackDepth === 0 ) {
				var scrollWidth = window.innerWidth - document.documentElement.clientWidth;
				var bodyMargin = parseFloat( $body.css( 'margin-right' ) ) || 0;
				$body
					.addClass( 'oo-ui-windowManager-modal-active' )
					.css( 'margin-right', bodyMargin + scrollWidth );
			}
			stackDepth++;
			this.globalEvents = true;
		}
	} else if ( this.globalEvents ) {
		$window.off( {
			// Stop listening for top-level window dimension changes
			'orientationchange resize': this.onWindowResizeHandler,
			focus: this.onWindowFocusHandler
		} );
		stackDepth--;
		if ( stackDepth === 0 ) {
			$body
				.removeClass( 'oo-ui-windowManager-modal-active' )
				.css( 'margin-right', '' );
		}
		this.globalEvents = false;
	}
	$body.data( 'windowManagerGlobalEvents', stackDepth );

	return this;
};

/**
 * Toggle isolation of content other than the window manager.
 *
 * This hides the content from screen readers (aria-hidden) and makes
 * it invisible to user input events (inert).
 *
 * @private
 * @param {boolean} [isolate] Make only the window manager visible to screen readers
 * @chainable
 * @return {OO.ui.WindowManager} The manager, for chaining
 */
OO.ui.WindowManager.prototype.toggleIsolation = function ( isolate ) {
	this.isolated = isolate === undefined ? !this.isolated : !!isolate;

	if ( this.isolated ) {
		// In case previously set by another window manager
		this.$element
			.removeAttr( 'aria-hidden' )
			.removeAttr( 'inert' );

		var $el = this.$element;

		var ariaHidden = [];
		var inert = [];

		// Walk up the tree
		while ( !$el.is( 'body' ) && $el.length ) {
			// Hide all siblings at each level, just leaving the path to the manager visible.
			var $siblings = $el.siblings().not( 'script' );
			// $ariaHidden/$inert exclude elements which already have aria-hidden/inert set,
			// as we wouldn't want to reset those attributes when window closes.
			// This will also support multiple window managers opening on top of each other,
			// as an element hidden by another manager will not be re-enabled until *that*
			// manager closes its window.
			ariaHidden.push.apply( ariaHidden, $siblings.not( '[aria-hidden=true]' ).toArray() );
			inert.push.apply( inert, $siblings.not( '[inert]' ).toArray() );
			$el = $el.parent();
		}
		// Build lists as plain arrays for performance ($.add is slow)
		this.$ariaHidden = $( ariaHidden );
		this.$inert = $( inert );

		// Hide everything other than the window manager from screen readers
		this.$ariaHidden.attr( 'aria-hidden', 'true' );
		this.$inert.attr( 'inert', '' );
	} else {
		// Restore screen reader visibility
		this.$ariaHidden.removeAttr( 'aria-hidden' );
		this.$inert.removeAttr( 'inert' );
		this.$ariaHidden = null;
		this.$inert = null;

		// and hide the window manager
		this.$element
			.attr( 'aria-hidden', 'true' )
			.attr( 'inert', '' );
	}

	return this;
};

// Deprecated alias, since 0.44.1
OO.ui.WindowManager.prototype.toggleAriaIsolation = OO.ui.WindowManager.prototype.toggleIsolation;

/**
 * Destroy the window manager.
 */
OO.ui.WindowManager.prototype.destroy = function () {
	this.clearWindows();
	this.$element.remove();
};
