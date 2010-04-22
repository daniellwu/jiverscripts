/*
 * Copyright 2010 Jive Software
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * jive.conc.Promise
 *
 * requires jive.conc.observable
 *
 * Promises are objects that are used to reference the outcomes of asynchronous
 * operations.  This implementation is based on the Promise API formerly
 * implemented in Node.js <http://nodejs.org/>.
 *
 * For example, consider this function:
 *
 *     function getFriends(userID) {
 *         var url = "/users/"+ userID +"/friends.json";
 *         $.getJSON(url);
 *         // what to return??
 *     }
 *
 * There is no way to give the result of that REST call as a return value of
 * `getFriends()` because `getJSON()` is an asynchronous operation.  One way
 * around this is to allow the caller to provide a callback that can be invoked
 * when the JSON response is ready:
 *
 *     function getFriends(userID, callback) {
 *         var url = "/users/"+ userID +"/friends.json";
 *         $.getJSON(url, function(json) {
 *             callback(json);
 *         });
 *     }
 *
 * That approach works nicely.  But if you want to do something more advanced
 * like to provide separate callbacks for successes and errors you have to add
 * yet another argument.
 *
 * Promises abstract the pattern of passing data asynchronously.
 * `jive.conc.Promise` mixes in `jive.conc.observable` and can emit three
 * events: 'succes', 'error', and 'cancel'.  A function that performs an
 * asynchronous operation can a return a promise object which a caller can
 * listen to for success or error events.  `Promise` also adds the convenience
 * methods `addCallback()` and `addErrback()` to make listening to those events
 * as simple as possible.
 *
 * In the `getFriends()` example you would use a promise like this:
 *
 *     function getFriends(userID) {
 *         var url = "/users/"+ userID +"/friends.json",
 *             promise = new jive.conc.Promise();
 *         $.ajax({
 *             url: url,
 *             type: 'GET',
 *             dataType: 'json',
 *             success: function(json) {
 *                 promise.emitSuccess(json)
 *             },
 *             error: function(xhr) {
 *                 promise.emitError(xhr.status);
 *             }
 *         });
 *         return promise;
 *     }
 *
 * This implementation of `getFriends()` might be called like this:
 *
 *     getFriends(myID).addCallback(function(friends) {
 *         friends.forEach(displayFriend);
 *     }).addErrback(function(status) {
 *         if (status == 404) {
 *             alert("Error: you have no friends!");
 *         }
 *     });
 * 
 * Promises can also be given a timeout.  If the timeout expires before the
 * promise is fulfilled then the promise will emit an error:
 *
 *     getFriends(myID).timeout(10000).addErrback(function(error) {
 *         if (e.toString().match("timeout")) {
 *             alert("Wow, this server is slooooow.");
 *         }
 *     });
 *
 * A promise will only emit an event once.  Once it has emitted a success,
 * error, or cancel event it will not emit any more events.
 */

/*jslint browser:true */
/*extern jive */

jive = jive || {};
jive.conc = jive.conc || {};

jive.conc.Promise = function() {
    jive.conc.observable(this);

    var hasFired = false,
        cancelled = false,
        timeoutDuration,
        timer,
        self = this;

    /**
     * addCallback(callback) -> receiver
     * - callback (Function): function to be called when the promise emits
     *   'success'
     * 
     * Adds a 'success' callback to the promise.  Returns the receiver so that
     * this method can be cascaded.
     **/
    this.addCallback = function(listener) {
        this.addListener('success', listener);
        return this;
    };

    /**
     * addErrback(callback) -> receiver
     * - callback (Function): function to be called when the promise emits
     *   'error'
     * 
     * Adds an 'error' callback to the promise.  Returns the receiver so that
     * this method can be cascaded.
     **/
    this.addErrback = function(listener) {
        this.addListener('error', listener);
        return this;
    };

    /**
     * addCancelback(callback) -> receiver
     * - callback (Function): function to be called when the promise emits
     *   'cancel'
     * 
     * Adds a 'cancel' callback to the promise.  The promise will emit 'cancel'
     * when it is explicitly cancelled.  Returns the receiver so that this
     * method can be cascaded.
     **/
    this.addCancelback = function(listener) {
        this.addListener('cancel', listener);
        return this;
    };

    /**
     * emitSuccess([eventArg1, eventArg2, ...]) -> undefined
     * eventArgs (*): arguments to be emitted with the 'success' event
     *
     * Causes the promise to emit 'success'.  Any arguments given will be
     * passed to callbacks for the promise's 'success' event.
     *
     * Calling this method prevents the promise from emitting any further
     * events.
     */
    this.emitSuccess = function() {
        var eventArgs = Array.prototype.slice.call(arguments, 0);
        if (!hasFired) {
            hasFired = true;
            this.emit.apply(this, ['success'].concat(eventArgs));
        }
    };

    /**
     * emitError([eventArg1, eventArg2, ...]) -> undefined
     * eventArgs (*): arguments to be emitted with the 'error' event
     *
     * Causes the promise to emit 'error'.  Any arguments given will be
     * passed to callbacks for the promise's 'error' event.
     *
     * Calling this method prevents the promise from emitting any further
     * events.
     */
    this.emitError = function() {
        var eventArgs = Array.prototype.slice.call(arguments, 0);
        if (!hasFired) {
            hasFired = true;
            this.emit.apply(this, ['error'].concat(eventArgs));
        }
    };

    function emitCancel() {
        var eventArgs = Array.prototype.slice.call(arguments, 0);
        self.emit.apply(self, ['cancel'].concat(eventArgs));
    };

    /**
     * cancel() -> undefined
     *
     * Cancels the promise.  This causes the promise to emit 'cancel'.
     *
     * In most cases the class or function that creates a promise will send
     * messages through the promise while callers listen for events.  However
     * with 'cancel' it may be useful to do the reverse: the creator of the
     * promise could abort some long running operation when a caller cancels
     * the promise.
     *
     * Calling this method prevents the promise from emitting any further
     * events.
     */
    this.cancel = function() {
        if (!cancelled) {
            cancelled = true;
            this.removeListener('success');
            this.removeListener('error');
            emitCancel();
        }
    };

    /**
     * timeout(delay) -> receiver
     * delay (number): time in milliseconds to wait before aborting the promise
     *
     * timeout() -> number
     *
     * Calling this method with a `delay` argument causes the timeout to abort
     * after the given length of time.  If the promise has not emitted some
     * event by the time the timout expires then the promise will emit an
     * 'error' event with a single argument of the form, `new Error('timout')`.
     *
     * Calling `timeout()` with a `delay` argument a second time will cancel
     * the previous timeout and will start a new timeout.
     *
     * Calling `timeout()` with no arguments will have no side-effect but will
     * return the timeout that has already been set in milliseconds.  If no
     * timeout has been set then calling `timout()` with no arguments will
     * return `undefined`.
     */
    this.timeout = function(timeout) {
        if (typeof timeout == 'undefined') {
            return timeoutDuration;
        }

        timeoutDuration = timeout;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        timer = setTimeout(function() {
            timer = null;
            if (!hasFired && !cancelled) {
                self.emitError(new Error('timeout'));
            }
        }, timeoutDuration);

        return this;
    };
};