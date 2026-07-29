import re

file_path = 'frontend/src/lib/api.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = {
    'export function getAllAuctions()': '/**\n * Fetches all available auctions.\n * @returns {Promise<Array>} List of auctions.\n */\nexport function getAllAuctions()',
    'export function getAuction(auctionId)': '/**\n * Retrieves details for a specific auction.\n * @param {string} auctionId - The unique identifier of the auction.\n * @returns {Promise<Object>} Auction details.\n */\nexport function getAuction(auctionId)',
    'export function getUserBidsApi(userId)': '/**\n * Fetches the highest bids placed by a user across all auctions.\n * @param {string} [userId] - Optional user identifier.\n * @returns {Promise<Array>} List of user bids.\n */\nexport function getUserBidsApi(userId)',
    'export function getAuctionHistory(auctionId, userId)': '/**\n * Retrieves the bidding history for a specific auction.\n * @param {string} auctionId - The unique identifier of the auction.\n * @param {string} [userId] - Optional user identifier to filter history.\n * @returns {Promise<Array>} List of historical bids.\n */\nexport function getAuctionHistory(auctionId, userId)',
    'export async function uploadImages(files)': '/**\n * Uploads a collection of images to the server.\n * @param {FileList|Array} files - The image files to upload.\n * @returns {Promise<Object>} Upload response containing image URLs.\n */\nexport async function uploadImages(files)'
}

for old, new_ in replacements.items():
    content = content.replace(old, new_)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("JSDoc added.")
