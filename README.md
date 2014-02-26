appCache
========

An enhanced emulation for html5 application cache.
Inspired by html5 application cache, add the "PNP" feature.

Why don't use the html5 application cache? 
  a: compatible
  b: Can't meet the custom requirement
 
Usage: appCache.init("cache.manifest")
Cache data structure: {"lastModified":'',"data":{}}
 
Note: for keeping the data synchronization, cache updation is  batch operation, that mean may be successful or failed all.
TODO: !!Application Cache Group!!
