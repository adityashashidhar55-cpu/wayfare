-- Wayfare full schema, generated from db/schema.ts
-- Paste into any MySQL console (TiDB web SQL editor, phpMyAdmin, mysql CLI).
-- Safe to re-run: every statement is CREATE TABLE IF NOT EXISTS.
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `unionId` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NULL,
  `email` VARCHAR(320) NULL,
  `passwordHash` VARCHAR(255) NULL,
  `avatar` TEXT NULL,
  `role` ENUM('user','admin') NOT NULL DEFAULT 'user',
  `referralCode` VARCHAR(12) NULL,
  `referredById` BIGINT UNSIGNED NULL,
  `timezone` VARCHAR(64) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lastSignInAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_unionId` (`unionId`),
  UNIQUE KEY `uq_users_referralCode` (`referralCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `preferences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `styles` JSON NULL,
  `budgetBand` VARCHAR(32) NULL DEFAULT 'mid',
  `pace` VARCHAR(32) NULL DEFAULT 'balanced',
  `interests` JSON NULL,
  `cuisines` JSON NULL,
  `dietary` VARCHAR(24) NULL DEFAULT 'non-veg',
  `companions` VARCHAR(32) NULL DEFAULT 'friends',
  `homeCurrency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `archetype` VARCHAR(64) NULL,
  `onboardingDone` BOOLEAN NOT NULL DEFAULT 0,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_preferences_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trips` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ownerId` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `destination` VARCHAR(255) NOT NULL,
  `coverImage` VARCHAR(512) NULL,
  `startDate` VARCHAR(10) NOT NULL,
  `endDate` VARCHAR(10) NOT NULL,
  `homeCurrency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `budgetCents` INT NOT NULL DEFAULT 0,
  `budgetCurrency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `originCity` VARCHAR(255) NULL,
  `adults` INT NOT NULL DEFAULT 2,
  `children` INT NOT NULL DEFAULT 0,
  `intent` TEXT NULL,
  `flexibility` VARCHAR(16) NULL,
  `foodPrefs` TEXT NULL,
  `mustSee` TEXT NULL,
  `hotelName` VARCHAR(255) NULL,
  `hotelAddress` VARCHAR(512) NULL,
  `hotelLat` DOUBLE NULL,
  `hotelLng` DOUBLE NULL,
  `hotelSource` VARCHAR(16) NULL,
  `tripType` VARCHAR(16) NULL DEFAULT 'city',
  `originName` VARCHAR(255) NULL,
  `originLat` DOUBLE NULL,
  `originLng` DOUBLE NULL,
  `intercityMode` VARCHAR(16) NULL DEFAULT 'car',
  `withChildren` BOOLEAN NULL DEFAULT 0,
  `childAges` VARCHAR(64) NULL,
  `shareToken` VARCHAR(36) NULL,
  `timezone` VARCHAR(64) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(320) NULL,
  `role` ENUM('owner','editor','viewer') NOT NULL DEFAULT 'editor',
  `presenceColor` VARCHAR(16) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_days` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `position` INT NOT NULL DEFAULT 0,
  `transportMode` VARCHAR(16) NOT NULL DEFAULT 'car',
  `hotelName` VARCHAR(255) NULL,
  `hotelAddress` VARCHAR(512) NULL,
  `hotelLat` DOUBLE NULL,
  `hotelLng` DOUBLE NULL,
  `flexible` BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `stops` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `dayId` BIGINT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'activity',
  `address` VARCHAR(512) NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `startTime` VARCHAR(5) NULL,
  `durationMin` INT NULL,
  `notes` TEXT NULL,
  `image` VARCHAR(512) NULL,
  `famousEatery` BOOLEAN NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `bookingUrl` TEXT NULL,
  `bookedAt` TIMESTAMP NULL,
  `transportMode` VARCHAR(16) NULL,
  `transportCents` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `expenses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `paidById` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'other',
  `amountCents` INT NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `homeCents` INT NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `expense_splits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `expenseId` BIGINT UNSIGNED NOT NULL,
  `memberId` BIGINT UNSIGNED NOT NULL,
  `shareCents` INT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `settlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `fromMemberId` BIGINT UNSIGNED NOT NULL,
  `toMemberId` BIGINT UNSIGNED NOT NULL,
  `amountCents` INT NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `note` VARCHAR(255) NULL,
  `recordedById` BIGINT UNSIGNED NOT NULL,
  `settledAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_settlements_trip` (`tripId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `type` VARCHAR(24) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `provider` VARCHAR(255) NULL,
  `confirmationCode` VARCHAR(64) NULL,
  `startDate` VARCHAR(10) NULL,
  `endDate` VARCHAR(10) NULL,
  `details` TEXT NULL,
  `amountCents` INT NULL,
  `currency` VARCHAR(3) NULL,
  `paidById` BIGINT UNSIGNED NULL,
  `source` VARCHAR(24) NULL DEFAULT 'manual',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `checklist_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `list` VARCHAR(24) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `done` BOOLEAN NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0,
  `ownerId` BIGINT UNSIGNED NULL,
  `visibility` ENUM('shared','private') NOT NULL DEFAULT 'shared',
  `assignedMemberId` BIGINT UNSIGNED NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_checklist_trip` (`tripId`,`list`),
  KEY `idx_checklist_owner` (`tripId`,`ownerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_notes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NULL DEFAULT 'Notes',
  `content` TEXT NULL,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `bucket_list` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `country` VARCHAR(255) NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `image` VARCHAR(512) NULL,
  `note` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `tier` ENUM('wanderer','voyager') NOT NULL DEFAULT 'wanderer',
  `status` VARCHAR(24) NOT NULL DEFAULT 'active',
  `currentPeriodEnd` VARCHAR(10) NULL,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscriptions_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `posts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content` TEXT NULL,
  `coverImage` VARCHAR(512) NULL,
  `placeIds` JSON NULL,
  `status` ENUM('draft','published') NOT NULL DEFAULT 'draft',
  `source` VARCHAR(24) NULL DEFAULT 'manual',
  `sourceUrl` VARCHAR(512) NULL,
  `gallery` JSON NULL,
  `likes` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `explore_places` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `nameLocal` VARCHAR(255) NULL,
  `city` VARCHAR(255) NOT NULL,
  `country` VARCHAR(255) NOT NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `category` VARCHAR(32) NOT NULL,
  `tags` JSON NULL,
  `styles` JSON NULL,
  `rating` DOUBLE NULL,
  `priceLevel` INT NULL,
  `feeCents` INT NULL,
  `feeCurrency` VARCHAR(3) NULL,
  `feeNote` VARCHAR(255) NULL,
  `image` VARCHAR(512) NULL,
  `description` TEXT NULL,
  `descriptionSource` VARCHAR(16) NULL,
  `hidden` BOOLEAN NOT NULL DEFAULT 0,
  `osmId` VARCHAR(32) NULL,
  `source` VARCHAR(16) NULL DEFAULT 'curated',
  `addedById` BIGINT UNSIGNED NULL,
  `approved` BOOLEAN NOT NULL DEFAULT 1,
  `mealCents` INT NULL,
  `mealNote` VARCHAR(255) NULL,
  `closedStatus` VARCHAR(24) NULL DEFAULT 'open',
  `verdict` VARCHAR(16) NULL,
  `photoSource` VARCHAR(32) NULL,
  `photoAttribution` VARCHAR(255) NULL,
  `famousEatery` BOOLEAN NOT NULL DEFAULT 0,
  `qualityScore` INT NOT NULL DEFAULT 0,
  `isChain` BOOLEAN NOT NULL DEFAULT 0,
  `isJunk` BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_explore_city_famous` (`city`,`country`,`famousEatery`),
  KEY `idx_explore_addedby` (`addedById`),
  KEY `idx_explore_latlng` (`lat`,`lng`),
  KEY `idx_explore_cat_latlng` (`category`,`lat`,`lng`),
  KEY `idx_explore_city_quality` (`city`,`qualityScore`),
  KEY `idx_explore_quality` (`qualityScore`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `signature_dishes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `city` VARCHAR(128) NOT NULL,
  `country` VARCHAR(128) NOT NULL,
  `dish` VARCHAR(128) NOT NULL,
  `blurb` TEXT NULL,
  `position` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_signature_dishes_city` (`city`,`country`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `signature_dish_places` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dishId` BIGINT UNSIGNED NOT NULL,
  `placeId` BIGINT UNSIGNED NULL,
  `name` VARCHAR(191) NOT NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `why` VARCHAR(255) NULL,
  `position` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_signature_dish_places_dish` (`dishId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `location_shares` (
  `tripId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `sharing` BOOLEAN NOT NULL DEFAULT 1,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tripId`,`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `city_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `city` VARCHAR(255) NOT NULL,
  `country` VARCHAR(255) NULL,
  `message` VARCHAR(255) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `city_requests_user_city` (`userId`,`city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `place_comments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `placeId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `text` VARCHAR(1000) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `api_cache` (
  `k` VARCHAR(191) NULL,
  `v` MEDIUMTEXT NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `support_tickets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `category` VARCHAR(32) NOT NULL,
  `message` TEXT NOT NULL,
  `email` VARCHAR(320) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'open',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `destination` VARCHAR(255) NOT NULL,
  `country` VARCHAR(255) NULL,
  `days` INT NOT NULL,
  `summary` TEXT NULL,
  `coverImage` VARCHAR(512) NULL,
  `payloadJson` JSON NOT NULL,
  `popularity` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trip_templates_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `friend_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ownerId` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'voting',
  `deadlineAt` TIMESTAMP NOT NULL,
  `minAvailable` INT NOT NULL DEFAULT 2,
  `tripId` BIGINT UNSIGNED NULL,
  `suggestionsJson` TEXT NULL,
  `budgetCents` INT NULL,
  `budgetCurrency` VARCHAR(3) NULL DEFAULT 'USD',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `friend_participants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sessionId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NULL,
  `token` VARCHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(320) NULL,
  `homeName` VARCHAR(255) NULL,
  `homeLat` DOUBLE NULL,
  `homeLng` DOUBLE NULL,
  `prefsJson` TEXT NULL,
  `datesJson` TEXT NULL,
  `submittedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fp_token` (`token`),
  KEY `idx_fp_session` (`sessionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `friend_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sessionId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NULL,
  `name` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fm_session` (`sessionId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `published_trips` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `ownerId` BIGINT UNSIGNED NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `summary` TEXT NULL,
  `isOpen` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pt_trip` (`tripId`),
  UNIQUE KEY `uq_pt_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_join_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publishedId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `message` VARCHAR(500) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tjr_pub_user` (`publishedId`,`userId`),
  KEY `idx_tjr_pub` (`publishedId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_updates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publishedId` BIGINT UNSIGNED NOT NULL,
  `authorId` BIGINT UNSIGNED NULL,
  `body` TEXT NOT NULL,
  `kind` VARCHAR(16) NOT NULL DEFAULT 'note',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tu_pub` (`publishedId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `api_usage` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_apiusage_user_kind` (`userId`,`kind`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NULL,
  `tripId` BIGINT UNSIGNED NULL,
  `readAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `wishlist_trips` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `destination` VARCHAR(255) NOT NULL,
  `notes` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wishlist_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `token_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `amount` INT NOT NULL,
  `eventKey` VARCHAR(128) NOT NULL,
  `meta` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token_event_key` (`userId`,`eventKey`),
  KEY `idx_token_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `trip_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `authorName` VARCHAR(255) NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `stopId` BIGINT UNSIGNED NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trip_messages` (`tripId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `stop_votes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tripId` BIGINT UNSIGNED NOT NULL,
  `stopId` BIGINT UNSIGNED NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `vote` ENUM('up','down') NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stop_vote` (`stopId`,`userId`),
  KEY `idx_stop_votes_trip` (`tripId`,`stopId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `usedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_reset_token` (`tokenHash`),
  KEY `idx_password_reset_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `provider` VARCHAR(24) NOT NULL DEFAULT 'razorpay',
  `orderId` VARCHAR(64) NOT NULL,
  `paymentId` VARCHAR(64) NULL,
  `amount` INT NOT NULL,
  `currency` VARCHAR(8) NOT NULL,
  `billingInterval` ENUM('monthly','yearly') NOT NULL,
  `status` ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
  `raw` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_order` (`orderId`),
  KEY `idx_payment_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `fx_rates` (
  `code` VARCHAR(8) NULL,
  `perUsd` DOUBLE NOT NULL,
  `fetchedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `rewards_redeemed` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `rewardId` VARCHAR(64) NOT NULL,
  `cost` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rewards_user` (`userId`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
