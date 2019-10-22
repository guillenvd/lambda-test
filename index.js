// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

// constants
const percentageSmall = 20;
const percentageMedium = 40;

const mediumAttributes = { height: 0, width: 0 };
const smallAttributes = { height: 0, width: 0 };

// get reference to S3 client 
var s3 = new AWS.S3();
 

exports.handler = (event, context, callback)  => {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
    const srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    const srcKey    = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));  
    const dstBucket = `${srcBucket}resized`;
    const mediumName = srcKey.replace('LARGESIZE', 'MEDIUMSIZE');
    const smallName = srcKey.replace('LARGESIZE', 'SMALLSIZE');

    console.log('====>  process.env.BUCKET_OUTPUT',  process.env.BUCKET_OUTPUT)
    // Sanity check: validate that source and destination are different buckets.
    if (srcBucket == dstBucket) {
        callback("Source and destination buckets are the same.");
        return;
    }

    if(!srcKey.includes("LARGESIZE")) {
        callback("The image is not the Large.");
        return;
    }
    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        callback("Could not determine the image type.");
        return;
    }
    console.log('====> typeMatch', typeMatch);
    var imageType = typeMatch[1].toLowerCase();
    if (imageType != "jpg" && imageType != "png") {
        callback(`Unsupported image type: ${imageType}`);
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
            // Download the image from S3 into a buffer.
            s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                },
                next);
            },
        function getImageSizes(response, next) {
            gm(response.Body).size(function(err, size) {
                // Infer the scaling factor to avoid stretching the image unnaturally.
                mediumAttributes.width  = Math.round(size.width * percentageMedium / 100);
                mediumAttributes.height = Math.round(size.height * percentageMedium / 100);
                smallAttributes.width  = Math.round(size.width * percentageSmall / 100);
                smallAttributes.height = Math.round(size.height * percentageSmall / 100);
                console.log('=====> mediumAttributes', mediumAttributes);
                console.log('=====> smallAttributes', smallAttributes);
                next(null, response);
            });
        },
        function transformMedium(response, next) {
            console.log('=====> mediumAttributes', mediumAttributes);
            console.log('=====> smallAttributes', smallAttributes);
            gm(response.Body).size(function(err, size) {
                this.resize(mediumAttributes.width, mediumAttributes.height)
                    .toBuffer(imageType, (err, buffer) => {
                        if (err) {
                            next(err);
                        } else {
                            next(null, response.ContentType, buffer);
                        }
                    });
            });
        },
        function uploadMedium(contentType, data, next) {
            // Stream the transformed image to a different S3 bucket.
            console.log('====> mediumName', mediumName);
            s3.putObject({
                    Bucket: dstBucket,
                    Key: mediumName,
                    Body: data,
                    ContentType: contentType
                },
                next);
            }
        ], 
        (err) => {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + mediumName
                );
            }
        
            callback(null, "message");
        }
    );
};
