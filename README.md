appCache
========

An enhanced emulation for html5 application cache. <br />
Inspired by html5 application cache, add the "PNP" feature. <br />

Why don't use the html5 application cache? <br />
  a: compatible <br />
  b: Can't meet the custom requirement <br />
 
Usage: appCache.init("cache.manifest") <br />
Cache data structure: {"lastModified":'',"data":{}} <br />
 
Note: for keeping the data synchronization, cache updation is  batch operation, that mean may be successful or failed all. <br />
TODO: !!Application Cache Group!!
