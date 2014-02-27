/**
 * Inspired by html5 application cache, add the "PNP" feature
 * Why don't use the html5 application cache? a: compatible, b: Can't meet the custom requirement
 * Usage: appCache.init("cache.manifest")
 * Cache data structure: {"lastModified":'',"data":{}}
 * Note: for keeping the data synchronization, cache updation is  batch operation, that mean may be successful or failed all.
 * TODO: !!Application Cache Group!!
 */
(function (global, factory) {
    'use strict';
    // Node.js, CommonJS, CommonJS Like
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(global, true);
    } else {
        factory();
    }

})(this, function (global, noGlobal) {
    var appCache = {};
    if (noGlobal) {
        global.appCache = appCache;
    }

    // Support cmd && amd
    if (define && (define.cmd || define.amd)) {
        return define("appcache", [], factory);
    }
    // Global require
    if (typeof require === 'function') {
        return factory(require);
    }
    // Common
    return factory(function (id) {
        var key;
        for (key in global)
            if (key.toLowerCase() === id.toLowerCase())
                return global[key];
    });

    function factory(require, exports) {
        var 
        $ = require('jquery'),
        lawnchair = require('lawnchair'),
        urlobj = require('url'), // http://github.com/1024bit/url
        version = '', // Version no.
        cacheManifest = '', // Cache manifest url
        id = '', // encrypt(url)
        policies = {}, // Cache policies
        status = 0, // Status code
        statusText = 'UNCACHED', // Status description
        bufferPool = [], // Temporary cache
        accessLogs = [], // Access logs
        fetchQueue = [], // Request queue
        preload = [], // Prefetching list
        baseUrl = urlobj.resolve($('base').eq(0).attr('href') || location.href), // Base url
        _ajaxInstances = []; // All ajax instances

        lawnchair = function (options, callback) {
            Lawnchair(options, callback);
        };

        // Initialize access logs
        lawnchair({
            name : 'appcache'
        }, function () {
            this.exists('accesslogs', function (exists) {
                if (exists) {
                    this.get('accesslogs', function (r) {
                        accessLogs = r.accesslogs;
                    });
                }
            });
        });

        // Initialize cache setting
        // Consider cookies have the same name with different attrs
        id = encrypt(urlobj.addQueries(urlobj.getAbsoluteUrl(urlobj.resolve(cacheManifest), baseUrl)) + document.cookies);
        lawnchair({
            name : 'appcache'
        }, function () {
            this.exists(id, function (exists) {
                if (exists) {
                    this.get(id, function (r) {
                        preload = r.data.CACHE;
                        version = r.data.VERSION;
                        policies = r.data;
                    });
                }
            });
        });

        appCache.jqAppCache = $(appCache);

        // A common http request
        function sendHttp(ajaxOpts) {
            var record,
            deferred = $.Deferred(),
            _id = id,
            _success,
            _error,
            modified = true;

            // Fetch data from appcache
            lawnchair({
                name : 'appcache'
            }, function () {
                this.get(_id, function (r) {
                    record = r;
                });
            });
            _success = ajaxOpts.success;
            _error = ajaxOpts.error;
            $.extend(ajaxOpts, {
                success : function (data, textStatus, xhr) {
                    if (_success)
                        _success.call(this, data, textStatus, xhr);
                    switch (xhr.status) {
                        // Modified already
                    case 200:
                        record = {
                            key : _id,
                            lastModified : xhr.getResponseHeader('Last-Modified'),
                            data : data
                        };
                        // Consider the storage capacity of appcache, now only cache the url in the Cache.Manifest
                        if (ajaxOpts.cacheable) {
                            bufferPool.push(record);
                            // Cache update completely -> IDLE
                            if (status === 1 || status === 5) {
                                swapCache();
                            }
                        }
                        break;
                        // GET: Not modified, 304
                        // POST: Not modified, 412
                    case 304:
                    case 412:
                        modified = false;
                        break;
                    }
                    deferred.resolve(record, modified);
                },
                error : function (xhr, textStatus, error) {
                    if (_error)
                        _error.call(this, xhr, textStatus, error);
                    deferred.reject();
                }
            });
            if (record) {
                ajaxOpts.headers = ajaxOpts.headers || {};
                if (record.lastModified)
                    ajaxOpts.headers['If-Modified-Since'] = record.lastModified;
            }
            _get(ajaxOpts);
            return deferred.promise();
        };

        // Register every ajax
        function _get(ajaxOpts) {
            var
            _complete = ajaxOpts.complete,
            jqXHR;

            ajaxOpts.complete = function (jqXHR, textStatus) {
                _complete.call(this, jqXHR, textStatus);
                _ajaxInstances.splice($.inArray(jqXHR, _ajaxInstances), 1);
            };
            jqXHR = $.ajax(ajaxOpts);
            ajaxOpts.preloaded && (jqXHR.preloaded = true);
            _ajaxInstances.push(jqXHR);
        }

        // Execute external delay request
        function _unfreeze() {
            $.each(fetchQueue, function (idx) {
                fetchQueue.splice(idx, 1);
                this();
            });

        };

        // Single resource file request
        function fetch(ajaxOpts, deferred) {
            deferred = deferred || $.Deferred();
            if (typeof ajaxOpts === 'string')
                ajaxOpts = {
                    url : ajaxOpts
                };

            // Checking of cache update -> CHECKING
            if (status > 1 && status < 5 && !ajaxOpts.preloaded) {
                fetchQueue.push(function () {
                    fetch(ajaxOpts, deferred);
                });
                return deferred.promise();
            }

            var visited,
            policy, // Now, three policies are supported: CACHE, PNP, NETWORK
            url = ajaxOpts.url,
            inmanifest = false,
            u,
            abs = url;

            // Change the relative url to absolute url
            u = urlobj.resolve(abs);
            abs = urlobj.getAbsoluteUrl(u, baseUrl);
            ajaxOpts.url = abs;

            // The same address with different request body, may be return diff cookies
            id = encrypt(urlobj.addQueries(abs, $.extend(true, {}, ajaxOpts.data || {})) + document.cookies);
            // Url visited or not
            visited = ~$.inArray(id, accessLogs);
            // The url in the cache manifest or not
            $.each(policies, function (key) {
                if ($.isArray(this)) {
                    $.each(this, function (idx, val) {
                        if (abs === urlobj.getAbsoluteUrl(urlobj.resolve(val), baseUrl)) {
                            policy = key;
                            inmanifest = true;
                            return false;
                        }
                    });
                    if (inmanifest)
                        return false;
                }
            });
            if (visited) {
                //  Url in the cache manifest
                if (inmanifest) {
                    // "Non-Network" (Must not request) resource file
                    if (policy != 'NETWORK') {
                        // Read cache
                        lawnchair({
                            name : 'appcache'
                        }, function () {
                            this.get(id, function (r) {
                                // Return cache data
                                if (ajaxOpts.success) {
                                    var opts = $.extend(true, {}, $.ajaxSettings, ajaxOpts),
                                    context = opts.context ? opts.context : opts;
                                    ajaxOpts.success.call(context, r.data);
                                }
                                deferred.resolve(r);
                            });
                        });
                        return deferred.promise();
                    }
                }
            }

            // Only cache resource file in the cache manifest
            ajaxOpts.cacheable = inmanifest;
            // Long operation, request resource file
            sendHttp(ajaxOpts)
            .done(function (r, modified) {
                if (!visited) {
                    accessLogs.push(r.key);
                    lawnchair({
                        name : 'appcache'
                    }, function () {
                        this.save({
                            key : 'accesslogs',
                            accesslogs : accessLogs
                        });
                    });
                }
                deferred.resolve(r, modified);
                return deferred.promise();
            })
            .fail(function () {
                bufferPool = [];
                deferred.reject();
                return deferred.promise();
            });
            // Make the abort method supports deferred object
            deferred.url = abs;
            return deferred;
        };

        // Checking update
        function update() {
            var
            deferred,
            _abort = false,
            loaded = 0,
            total = 0;

            // Long operation, request cache manifest
            // synchronization lock
            deferred = fetch(cacheManifest)
                .done(function (r, modified) {
                    preload = r.data.CACHE;
                    version = r.data.VERSION;
                    policies = r.data;
                    if (modified) {
                        // Empty access logs
                        if (accessLogs.length) {
                            accessLogs = [r.key];
                            lawnchair({
                                name : 'appcache'
                            }, function () {
                                this.save({
                                    key : 'accesslogs',
                                    accesslogs : accessLogs
                                });
                            });
                        }

                        // Update appcache
                        lawnchair({
                            name : 'appcache'
                        }, function () {
                            this.save(r, function (r) {});
                        });

                    } else {
                        appCache.jqAppCache.trigger('noupdate');
                    }

                    // Trigger downloading event
                    appCache.jqAppCache.trigger('downloading');

                    // Foreach prefetching list
                    total = preload.length;
                    $.each(preload, function () {
                        // Long operation
                        fetch({
                            url : String(this),
                            preloaded : true
                        })
                        .done(function (r) {
                            loaded++;
                            // Trigger progress event, can be bind to progressbar
                            appCache.jqAppCache.trigger('progress', {
                                loaded : loaded,
                                total : total
                            });
                            // Trigger updateready event
                            if (loaded == total) {
                                appCache.jqAppCache.trigger('updateready');
                                swapCache();
                            }
                        })
                        .fail(function () {
                            _abort = true;
                            appCache.jqAppCache.trigger('error');
                            appCache.jqAppCache.trigger('obsolete');
                            // deferred.reject();
                            // return deferred.promise();
                        });
                        // Prevent aborting triggered by error
                        return !_abort;
                    });
                })
                .fail(function () {
                    appCache.jqAppCache.trigger('obsolete');
                });

            appCache.jqAppCache.trigger('checking');
        };

        // Update cache
        function swapCache() {
            if (bufferPool.length) {
                lawnchair({
                    name : 'appcache'
                }, function () {
                    this.batch(bufferPool);
                });
                bufferPool = [];
            }
            appCache.jqAppCache.trigger('cached');
            _unfreeze();
        };

        // Abort cache update
        function abort(xhr) {
            var req;
            if (status === 5) {
                // Abort all prefetching
                $.each(_ajaxInstances, function () {
                    this.preloaded && this.abort();

                });
                _unfreeze();
            } else {
                // Fetch single resource file, abort
                xhr.abort();
            }
        };
        // Call manually to initialize cacheManifest
        function init() {
            cacheManifest = arguments[0];
            update();
        };

        // Built-in encrypt algorithm, can overrid appCahce.encrypt that customize requirement
        function encrypt(url) {
            if (appCache.encrypt !== encrypt && typeof appCache.encrypt === 'function') {
                return appCache.encrypt(url);
            }
            return url;
        };

        /**
         * Events:
         * onchecking, ondownloading, onupdateready, onobsolete, oncached
         * onerror, onnoupdate, onprogress
         * Status:
         * 0: UNCACHED 1: IDLE 2: CHECKING 3: DOWNLOADING 4: UPDATEREADY 5: OBSOLETE
         */
        appCache.jqAppCache.on({
            checking : function () {
                status = 2;
                statusText = 'CHECKING';
                try {
                    echo('Checking for application update');
                } catch (error) {}
            },
            downloading : function () {
                status = 3;
                statusText = 'DOWNLOADING';
                try {
                    echo('Downloading application update');
                } catch (error) {}
            },
            updateready : function () {
                status = 4;
                statusText = 'UPDATEREADY';
                try {
                    echo('Application update ready');
                } catch (error) {}
            },
            cached : function () {
                status = 1;
                statusText = 'IDLE';
                try {
                    echo('Application cached');
                } catch (error) {}
            },
            // Response http status code is 404 or 410
            obsolete : function () {
                status = 5;
                statusText = 'OBSOLETE';
                try {
                    echo('Application obsolete');
                } catch (error) {}
                // Appcache update failed
                abort();
            },
            noupdate : function () {
                try {
                    // echo('No application update found');
                } catch (error) {}
            },
            progress : function (event, data) {
                try {
                    // echo('Application cache progress: ' + (data.loaded * 100 / data.total) + '%');
                } catch (error) {}
            },
            /**
             * a) The manifest file was modified when downloading
             * b) Ocurr fatal error when downloading single resource
             * c) Downloading of the html file which refers the manifest file is failed
             * d) The mainfest file's response http status code is 404 or 410
             */
            error : function () {
                try {
                    // echo('Application cache error');
                } catch (error) {}
            }
        });

        // API
        appCache.version = version;
        appCache.cacheManifest = cacheManifest;
        appCache.accessLogs = accessLogs;
        appCache.sendHttp = sendHttp;
        appCache.fetch = fetch;
        appCache.update = update;
        appCache.swapCache = swapCache;
        appCache.abort = abort;
        appCache.encrypt = encrypt;
        appCache.init = init;
        appCache.status = status;
        appCache.statusText = statusText;

        // Initialize
        // appCache.update();

        return appCache;
    }
});
